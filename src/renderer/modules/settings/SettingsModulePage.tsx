/**
 * Page de configuration d'un module spécifique (drilldown).
 *
 * Layout commun :
 *   ┌──────────────────────────────────────┐
 *   │ ← Back · <Label module> · [switch]  │  ← header
 *   ├──────────────────────────────────────┤
 *   │  Sections spécifiques au module      │
 *   └──────────────────────────────────────┘
 *
 * Pour les modules avec backend déjà câblé (music, tasks), on affiche
 * leurs vraies configs. Pour les modules en stub (meetings, gitlab,
 * claude, messages), on affiche un placeholder + le toggle d'activation
 * principal — les configs détaillées arriveront avec leurs backends.
 *
 * Le switch dans le header sert à activer/désactiver le module
 * directement depuis sa page (équivaut au toggle dans Home).
 */
import { useEffect, useRef, useState } from 'react';
import type {
  CalendarAccount,
  CalendarInfo,
  CalendarProviderId,
  ModuleId,
  OAuthClientCredentials,
  OutlookCategory,
} from '../../../shared/types';
import { useSettingsContext } from './SettingsContext';
import { useMeetingsContext } from '../meetings/MeetingsContext';
import { useToast } from '../toast/ToastContext';
import { MODULE_META_BY_ID } from './modulesMeta';
import { useMouseBackButton } from '../../hooks/useMouseBackButton';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import {
  SettingsRow,
  SettingsSection,
  SettingsSliderRow,
  SettingsToggle,
  SettingsToggleRow,
  SettingsRadioRow,
} from './atoms';

interface Props {
  moduleId: ModuleId;
  onBack: () => void;
}

export function SettingsModulePage({ moduleId, onBack }: Props) {
  const { settings, setModule } = useSettingsContext();
  const meta = MODULE_META_BY_ID[moduleId];
  const enabled = settings.modules[moduleId];

  // Esc / XButton1 → retour à la liste des modules. Le parent SettingsView
  // désactive ses propres handlers tant que `page !== null`, donc c'est
  // bien à cette sous-page de fournir le back.
  useMouseBackButton(onBack);
  useEscapeKey(onBack);

  return (
    <>
      <div className="settings-header">
        <button
          type="button"
          className="settings-header-btn"
          onClick={onBack}
          aria-label="Retour"
        >
          <i className="fa-solid fa-chevron-left" />
        </button>
        <div
          className="settings-row-icon"
          style={{ background: meta.color + '22', color: meta.color }}
        >
          <i className={meta.icon} />
        </div>
        <div className="settings-header-title">
          {meta.label}
          <span className="settings-header-sub">
            {enabled ? 'Activé' : 'Désactivé'}
          </span>
        </div>
        <SettingsToggle
          value={enabled}
          onChange={(next) => void setModule(moduleId, next)}
          ariaLabel={`Activer ${meta.label}`}
        />
      </div>

      {moduleId === 'music' && <MusicSettings />}
      {moduleId === 'tasks' && <TasksSettings />}
      {moduleId === 'meetings' && <MeetingsSettings />}
      {moduleId === 'gitlab' && <GitLabSettings />}
      {moduleId === 'gitlocal' && <GitLocalSettings />}
      {moduleId === 'claude' && <ClaudeSettings />}
      {moduleId === 'messages' && <MessagesSettings />}
      {moduleId === 'clipboard' && <ClipboardSettings />}
    </>
  );
}

/* ───────────── Music ───────────── */
function MusicSettings() {
  const { settings, patchModuleConfig } = useSettingsContext();
  const cfg = settings.moduleConfig.music;
  return (
    <SettingsSection title="Comportement">
      <SettingsToggleRow
        icon="fa-solid fa-eye-slash"
        iconColor="#f472b6"
        label="Masquer quand rien ne joue"
        description="La chip et la card disparaissent dès qu'aucune lecture n'est détectée."
        value={cfg.hideWhenStopped}
        onChange={(next) =>
          void patchModuleConfig('music', { hideWhenStopped: next })
        }
      />
      <SettingsToggleRow
        icon="fa-solid fa-minimize"
        iconColor="#f472b6"
        label="Afficher la chip dans le notch rétracté"
        description="Si désactivé, la musique est visible uniquement dans le dashboard étendu."
        value={cfg.collapsed}
        onChange={(next) =>
          void patchModuleConfig('music', { collapsed: next })
        }
      />
    </SettingsSection>
  );
}

/* ───────────── Tasks ───────────── */
function TasksSettings() {
  const { settings, patchModuleConfig } = useSettingsContext();
  const cfg = settings.moduleConfig.tasks;
  return (
    <>
      <SettingsSection title="Comportement">
        <SettingsRadioRow
          icon="fa-solid fa-arrow-down-wide-short"
          iconColor="#34d399"
          label="Tri par défaut"
          value={cfg.sortBy}
          options={[
            { value: 'created', label: 'Ajout' },
            { value: 'alpha', label: 'A → Z' },
          ]}
          onChange={(v) => void patchModuleConfig('tasks', { sortBy: v })}
        />
        <SettingsSliderRow
          icon="fa-solid fa-broom"
          iconColor="#34d399"
          label="Auto-supprimer les tâches terminées"
          description="Après ce nombre de jours. 0 = jamais."
          value={cfg.autoClearDays}
          min={0}
          max={30}
          step={1}
          formatValue={(v) => (v === 0 ? 'Jamais' : `${v} j`)}
          onChange={(v) =>
            void patchModuleConfig('tasks', { autoClearDays: v })
          }
        />
      </SettingsSection>
    </>
  );
}

/* ───────────── Meetings ───────────── */
function MeetingsSettings() {
  const { settings, patchModuleConfig } = useSettingsContext();
  const { connect, disconnect } = useMeetingsContext();
  const { push: pushToast } = useToast();
  const cfg = settings.moduleConfig.meetings;
  const [connecting, setConnecting] = useState<CalendarProviderId | null>(null);

  // État "credentials par défaut embarqués au build via .env.local".
  // Si présents, on ne pousse pas l'utilisateur à saisir les siens.
  const [defaults, setDefaults] = useState<Record<CalendarProviderId, boolean>>(
    { outlook: false, google: false },
  );
  useEffect(() => {
    void window.notch.meetings.hasDefaults().then(setDefaults);
  }, []);

  // Un provider est "prêt à connecter" si l'utilisateur a saisi un
  // clientId OU si des defaults sont embarqués.
  const outlookReady =
    defaults.outlook || !!cfg.clientCredentials.outlook?.clientId;
  const googleReady =
    defaults.google ||
    (!!cfg.clientCredentials.google?.clientId &&
      !!cfg.clientCredentials.google?.clientSecret);

  const handleConnect = async (provider: CalendarProviderId) => {
    setConnecting(provider);
    try {
      const res = await connect(provider);
      if (res.ok && res.account) {
        pushToast({
          icon: 'fa-solid fa-link',
          iconColor: 'var(--accent-green)',
          name: provider === 'outlook' ? 'Outlook' : 'Google',
          message: `Connecté · ${res.account.email}`,
        });
      } else {
        pushToast({
          icon: 'fa-solid fa-triangle-exclamation',
          iconColor: '#ef4444',
          name: 'Connexion',
          message: res.error ?? 'Échec',
        });
      }
    } finally {
      setConnecting(null);
    }
  };

  return (
    <>
      <SettingsSection title="Comptes connectés">
        {cfg.accounts.length === 0 ? (
          <div className="settings-empty">
            Aucun compte calendrier connecté. Renseigne les identifiants
            d'application ci-dessous, puis clique sur « Ajouter ».
          </div>
        ) : (
          cfg.accounts.map((acc) => (
            <AccountWithCalendars
              key={acc.id}
              account={acc}
              onDisconnect={() => void disconnect(acc.id)}
            />
          ))
        )}
        {/* Pas de onClick sur la row : seul le bouton "Ajouter" est
            l'élément interactif. Mettre les deux déclenchait le handler
            deux fois (bubble bouton → row → double ouverture du flow OAuth). */}
        <SettingsRow
          icon="fa-brands fa-microsoft"
          iconColor="#0078d4"
          label="Ajouter un compte Outlook / Microsoft 365"
          description={
            outlookReady
              ? defaults.outlook && !cfg.clientCredentials.outlook?.clientId
                ? 'Identifiants par défaut · lance le flow OAuth.'
                : 'Lance le flow OAuth dans le navigateur.'
              : "Configure d'abord le Client ID Azure plus bas."
          }
          right={
            <button
              type="button"
              className="settings-link-btn"
              disabled={!outlookReady || connecting === 'outlook'}
              onClick={() => void handleConnect('outlook')}
            >
              {connecting === 'outlook' ? 'En cours…' : 'Ajouter'}
            </button>
          }
        />
        <SettingsRow
          icon="fa-brands fa-google"
          iconColor="#4285f4"
          label="Ajouter un compte Google"
          description={
            googleReady
              ? defaults.google && !cfg.clientCredentials.google?.clientId
                ? 'Identifiants par défaut · lance le flow OAuth.'
                : 'Lance le flow OAuth dans le navigateur.'
              : "Configure d'abord le Client ID + Secret Google plus bas."
          }
          right={
            <button
              type="button"
              className="settings-link-btn"
              disabled={!googleReady || connecting === 'google'}
              onClick={() => void handleConnect('google')}
            >
              {connecting === 'google' ? 'En cours…' : 'Ajouter'}
            </button>
          }
        />
      </SettingsSection>

      {/* Les sections de saisie credentials sont masquées si l'app a des
          identifiants par défaut embarqués (et que l'utilisateur n'a pas
          souhaité les remplacer). Sinon on les affiche pour que
          l'utilisateur puisse les renseigner. */}
      {(!defaults.outlook || !!cfg.clientCredentials.outlook?.clientId) && (
        <ClientCredentialsSection
          provider="outlook"
          credentials={cfg.clientCredentials.outlook}
        />
      )}
      {(!defaults.google || !!cfg.clientCredentials.google?.clientId) && (
        <ClientCredentialsSection
          provider="google"
          credentials={cfg.clientCredentials.google}
        />
      )}

      <SettingsSection title="Comportement">
        <SettingsSliderRow
          icon="fa-solid fa-bell"
          iconColor="#60a5fa"
          label="Seuil « imminent »"
          description="Sous ce délai, le prochain meeting est mis en avant."
          value={cfg.imminentMin}
          min={1}
          max={30}
          step={1}
          formatValue={(v) => `${v} min`}
          onChange={(v) =>
            void patchModuleConfig('meetings', { imminentMin: v })
          }
        />
        <SettingsSliderRow
          icon="fa-solid fa-list"
          iconColor="#60a5fa"
          label="Nombre max de prochains rendez-vous"
          value={cfg.maxUpcoming}
          min={1}
          max={10}
          step={1}
          onChange={(v) =>
            void patchModuleConfig('meetings', { maxUpcoming: v })
          }
        />
        <SettingsToggleRow
          icon="fa-regular fa-eye-slash"
          iconColor="#60a5fa"
          label="Masquer les meetings déjà rejoints"
          value={cfg.hideJoinedToday}
          onChange={(next) =>
            void patchModuleConfig('meetings', { hideJoinedToday: next })
          }
        />
      </SettingsSection>
    </>
  );
}

/**
 * Bloc dépliable pour saisir les Client ID/Secret d'un provider OAuth.
 * Utilise un input contrôlé local pour ne pas spammer le main process à
 * chaque keystroke ; commit au blur du champ.
 */
function ClientCredentialsSection({
  provider,
  credentials,
}: {
  provider: CalendarProviderId;
  credentials: OAuthClientCredentials | null;
}) {
  const { patchModuleConfig, settings } = useSettingsContext();
  const [clientId, setClientId] = useState(credentials?.clientId ?? '');
  const [clientSecret, setClientSecret] = useState(
    credentials?.clientSecret ?? '',
  );
  const [tenantId, setTenantId] = useState(credentials?.tenantId ?? '');

  const commit = () => {
    const cfg = settings.moduleConfig.meetings.clientCredentials;
    void patchModuleConfig('meetings', {
      clientCredentials: {
        ...cfg,
        [provider]:
          clientId.trim() || clientSecret.trim()
            ? {
                clientId: clientId.trim(),
                clientSecret: clientSecret.trim() || undefined,
                tenantId: tenantId.trim() || undefined,
              }
            : null,
      },
    });
  };

  const isOutlook = provider === 'outlook';
  const title = isOutlook
    ? 'Identifiants Azure (Outlook)'
    : 'Identifiants Google';

  return (
    <SettingsSection title={title}>
      <div className="settings-credentials">
        <label className="settings-field">
          <span className="settings-field-label">Client ID</span>
          <input
            type="text"
            className="settings-field-input"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            onBlur={commit}
            placeholder={isOutlook ? 'GUID Application (Azure AD)' : 'xxx.apps.googleusercontent.com'}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        {!isOutlook && (
          <label className="settings-field">
            <span className="settings-field-label">Client Secret</span>
            <input
              type="password"
              className="settings-field-input"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              onBlur={commit}
              placeholder="GOCSPX-…"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
        )}
        {isOutlook && (
          <label className="settings-field">
            <span className="settings-field-label">
              Tenant ID <em>(optionnel — défaut: common)</em>
            </span>
            <input
              type="text"
              className="settings-field-input"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              onBlur={commit}
              placeholder="common · ou GUID Azure AD"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
        )}
        <div className="settings-credentials-hint">
          {isOutlook ? (
            <>
              Crée une <strong>App Registration</strong> sur{' '}
              <code>portal.azure.com</code> → Microsoft Entra ID → App
              Registrations. Type « Mobile and desktop applications »,
              redirect URI <code>http://localhost</code>. Permissions
              Microsoft Graph : <code>Calendars.Read</code>,{' '}
              <code>User.Read</code>, <code>offline_access</code>.
            </>
          ) : (
            <>
              Crée un <strong>OAuth 2.0 Client</strong> sur{' '}
              <code>console.cloud.google.com</code> → APIs & Services →
              Credentials. Type « Desktop app ». Active l'API{' '}
              <code>Google Calendar API</code> dans la library.
            </>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}

/**
 * Mapping approximatif des presets Outlook (`preset0`…`preset24`) vers
 * un hex pour afficher une pastille de couleur cohérente. On ne cherche
 * pas la fidélité pixel-perfect — juste une teinte plausible pour que
 * l'utilisateur reconnaisse ses catégories.
 */
const OUTLOOK_PRESET_HEX: Record<string, string> = {
  preset0: '#e74c3c', // rouge
  preset1: '#e67e22', // orange
  preset2: '#d4a373', // pêche
  preset3: '#f1c40f', // jaune
  preset4: '#2ecc71', // vert
  preset5: '#16a085', // bleu sarcelle
  preset6: '#7f8c8d', // olive
  preset7: '#3498db', // bleu
  preset8: '#9b59b6', // violet
  preset9: '#c0392b', // marron
  preset10: '#34495e', // acier
  preset11: '#2c3e50', // acier foncé
  preset12: '#95a5a6', // gris
  preset13: '#7f8c8d', // gris foncé
  preset14: '#1c1c1c', // noir
  preset15: '#922b21',
  preset16: '#b9770e',
  preset17: '#a04000',
  preset18: '#b7950b',
  preset19: '#196f3d',
  preset20: '#0e6655',
  preset21: '#7d6608',
  preset22: '#1a5276',
  preset23: '#6c3483',
  preset24: '#7b241c',
};
const DEFAULT_CATEGORY_HEX = '#94a3b8';

/**
 * Ligne de compte Meetings avec un panneau dépliable listant les
 * calendriers du compte. L'utilisateur peut cocher / décocher chaque
 * calendrier ; seuls les cochés sont agrégés dans les meetings affichés.
 *
 * Pour les comptes **Outlook**, une seconde sous-section permet aussi
 * d'exclure certaines catégories de couleur Outlook (liste noire) — les
 * events sans catégorie passent toujours.
 *
 * Lecture des données : on s'appuie d'abord sur le cache local
 * (`account.calendars` / `account.categories`, peuplés par le main au
 * prochain tick d'agrégation). Au premier déploiement, on appelle aussi
 * `listCalendars` + `listCategories` pour avoir un fetch frais — utile
 * quand l'utilisateur vient de connecter un compte et ouvre la section
 * avant qu'un tick ne soit passé.
 */
function AccountWithCalendars({
  account,
  onDisconnect,
}: {
  account: CalendarAccount;
  onDisconnect: () => void;
}) {
  const supportsCategories = account.provider === 'outlook';

  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Copies locales pour ne pas blinker en attendant que le store soit
  // re-broadcast après un setSelectedCalendars / setExcludedCategories.
  const [localCalendars, setLocalCalendars] = useState<CalendarInfo[] | null>(
    account.calendars ?? null,
  );
  const [localCategories, setLocalCategories] = useState<
    OutlookCategory[] | null
  >(account.categories ?? null);
  useEffect(() => {
    if (account.calendars) setLocalCalendars(account.calendars);
  }, [account.calendars]);
  useEffect(() => {
    if (account.categories) setLocalCategories(account.categories);
  }, [account.categories]);

  // Au premier déploiement seulement (et si pas encore de cache), tirer
  // un fetch frais. Sinon on attend le clic "Rafraîchir" de l'utilisateur.
  const firstExpansion = useRef(true);
  useEffect(() => {
    if (!expanded) return;
    if (!firstExpansion.current) return;
    firstExpansion.current = false;
    const needCalendars =
      !account.calendars || account.calendars.length === 0;
    const needCategories =
      supportsCategories &&
      (!account.categories || account.categories.length === 0);
    if (!needCalendars && !needCategories) return;
    setRefreshing(true);
    const calsP = needCalendars
      ? window.notch.meetings.listCalendars(account.id)
      : Promise.resolve(null);
    const catsP = needCategories
      ? window.notch.meetings.listCategories(account.id)
      : Promise.resolve(null);
    Promise.all([calsP, catsP]).then(([cals, cats]) => {
      if (cals) setLocalCalendars(cals);
      if (cats) setLocalCategories(cats);
      setRefreshing(false);
    });
  }, [
    expanded,
    account.id,
    account.calendars,
    account.categories,
    supportsCategories,
  ]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const [cals, cats] = await Promise.all([
        window.notch.meetings.listCalendars(account.id),
        supportsCategories
          ? window.notch.meetings.listCategories(account.id)
          : Promise.resolve(null),
      ]);
      if (cals) setLocalCalendars(cals);
      if (cats) setLocalCategories(cats);
    } finally {
      setRefreshing(false);
    }
  };

  // Sémantique calendrier : `selectedCalendarIds === undefined` → tout coché.
  const isCalChecked = (calId: string): boolean => {
    if (!account.selectedCalendarIds) return true;
    return account.selectedCalendarIds.includes(calId);
  };

  const toggleCalendar = async (calId: string) => {
    const current = account.selectedCalendarIds ?? (localCalendars ?? []).map((c) => c.id);
    const next = current.includes(calId)
      ? current.filter((id) => id !== calId)
      : [...current, calId];
    await window.notch.meetings.setSelectedCalendars(account.id, next);
  };

  // Sémantique catégorie : valeur du toggle = "masquée" (présente dans
  // excludedCategories). ON = la catégorie est exclue.
  const isCatExcluded = (name: string): boolean => {
    return (account.excludedCategories ?? []).includes(name);
  };

  const toggleCategory = async (name: string) => {
    const current = account.excludedCategories ?? [];
    const next = current.includes(name)
      ? current.filter((n) => n !== name)
      : [...current, name];
    await window.notch.meetings.setExcludedCategories(account.id, next);
  };

  return (
    <div className="meetings-account-block">
      <SettingsRow
        icon={
          account.provider === 'outlook'
            ? 'fa-brands fa-microsoft'
            : 'fa-brands fa-google'
        }
        iconColor={account.color}
        label={account.email}
        description={account.provider === 'outlook' ? 'Outlook' : 'Google'}
        right={
          <div className="meetings-account-actions">
            <button
              type="button"
              className="settings-link-btn"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              aria-label={expanded ? 'Masquer le panneau' : 'Afficher le panneau'}
            >
              <i
                className={
                  'fa-solid ' + (expanded ? 'fa-chevron-up' : 'fa-chevron-down')
                }
                style={{ marginRight: 4 }}
              />
              {supportsCategories ? 'Filtres' : 'Calendriers'}
            </button>
            <button
              type="button"
              className="settings-link-btn"
              onClick={onDisconnect}
            >
              Déconnecter
            </button>
          </div>
        }
      />
      {expanded && (
        <div className="meetings-calendars">
          <div className="meetings-subsection-title">Calendriers à inclure</div>
          {refreshing && (!localCalendars || localCalendars.length === 0) ? (
            <div className="settings-empty">Chargement des calendriers…</div>
          ) : !localCalendars || localCalendars.length === 0 ? (
            <div className="settings-empty">
              Impossible de récupérer la liste des calendriers. Vérifie que
              le compte est toujours autorisé puis clique sur Rafraîchir.
            </div>
          ) : (
            localCalendars.map((cal) => (
              <SettingsToggleRow
                key={cal.id}
                icon={cal.isPrimary ? 'fa-solid fa-star' : 'fa-regular fa-calendar'}
                iconColor={cal.color ?? '#60a5fa'}
                label={cal.name}
                description={cal.isPrimary ? 'Calendrier principal' : undefined}
                value={isCalChecked(cal.id)}
                onChange={() => void toggleCalendar(cal.id)}
              />
            ))
          )}

          {supportsCategories && (
            <>
              <div className="meetings-subsection-title">
                Catégories à masquer
              </div>
              {refreshing && (!localCategories || localCategories.length === 0) ? (
                <div className="settings-empty">Chargement des catégories…</div>
              ) : !localCategories || localCategories.length === 0 ? (
                <div className="settings-empty">
                  Aucune catégorie définie sur ce compte Outlook. Crée-en
                  depuis Outlook (clic droit sur un event → Catégoriser).
                </div>
              ) : (
                localCategories.map((cat) => (
                  <SettingsToggleRow
                    key={cat.name}
                    icon="fa-solid fa-tag"
                    iconColor={
                      cat.preset
                        ? OUTLOOK_PRESET_HEX[cat.preset] ?? DEFAULT_CATEGORY_HEX
                        : DEFAULT_CATEGORY_HEX
                    }
                    label={cat.name}
                    description={
                      isCatExcluded(cat.name)
                        ? 'Events masqués dans WinNotch'
                        : undefined
                    }
                    value={isCatExcluded(cat.name)}
                    onChange={() => void toggleCategory(cat.name)}
                  />
                ))
              )}
            </>
          )}

          <div className="meetings-calendars-footer">
            <button
              type="button"
              className="settings-link-btn"
              disabled={refreshing}
              onClick={() => void handleRefresh()}
            >
              <i
                className={
                  'fa-solid fa-arrows-rotate' + (refreshing ? ' fa-spin' : '')
                }
                style={{ marginRight: 4 }}
              />
              {refreshing ? 'Actualisation…' : 'Rafraîchir la liste'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────── GitLab ───────────── */
function GitLabSettings() {
  const { settings, patchModuleConfig } = useSettingsContext();
  const { push: pushToast } = useToast();
  const cfg = settings.moduleConfig.gitlab;

  // Inputs locaux contrôlés : on commit uniquement au clic "Connecter"
  // / "Tester". Le PAT n'est jamais relu depuis le main (sécurité), donc
  // si un compte est déjà connecté on affiche un placeholder masqué et
  // l'utilisateur doit ressaisir le token pour le remplacer.
  const [url, setUrl] = useState(cfg.url);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<'test' | 'save' | 'clear' | null>(null);

  // Re-sync url depuis le store si elle change ailleurs (clear, reload, etc.).
  useEffect(() => {
    setUrl(cfg.url);
  }, [cfg.url]);

  const handleTest = async () => {
    setBusy('test');
    try {
      const res = await window.notch.gitlab.testConnection(url, token);
      if (res.ok && res.user) {
        pushToast({
          icon: 'fa-brands fa-gitlab',
          iconColor: '#FC6D26',
          name: 'GitLab',
          message: `OK · ${res.user.username}`,
        });
      } else {
        pushToast({
          icon: 'fa-solid fa-triangle-exclamation',
          iconColor: '#ef4444',
          name: 'GitLab',
          message: res.error ?? 'Connexion impossible',
        });
      }
    } finally {
      setBusy(null);
    }
  };

  const handleConnect = async () => {
    setBusy('save');
    try {
      const res = await window.notch.gitlab.saveCredentials(url, token);
      if (res.ok) {
        setToken('');
        pushToast({
          icon: 'fa-brands fa-gitlab',
          iconColor: '#FC6D26',
          name: 'GitLab',
          message: 'Compte connecté',
        });
      } else {
        pushToast({
          icon: 'fa-solid fa-triangle-exclamation',
          iconColor: '#ef4444',
          name: 'GitLab',
          message: res.error ?? 'Connexion impossible',
        });
      }
    } finally {
      setBusy(null);
    }
  };

  const handleDisconnect = async () => {
    setBusy('clear');
    try {
      await window.notch.gitlab.clearCredentials();
      setToken('');
      pushToast({
        icon: 'fa-brands fa-gitlab',
        iconColor: '#94a3b8',
        name: 'GitLab',
        message: 'Compte déconnecté',
      });
    } finally {
      setBusy(null);
    }
  };

  const connected = !!cfg.account;
  const canSubmit = !!url.trim() && !!token.trim() && !busy;

  return (
    <>
      <SettingsSection title="Compte">
        {connected ? (
          <SettingsRow
            icon="fa-brands fa-gitlab"
            iconColor="#FC6D26"
            label={cfg.account!.name || cfg.account!.username}
            description={`@${cfg.account!.username} · ${cfg.url}`}
            right={
              <button
                type="button"
                className="settings-link-btn"
                disabled={busy === 'clear'}
                onClick={() => void handleDisconnect()}
              >
                {busy === 'clear' ? 'En cours…' : 'Déconnecter'}
              </button>
            }
          />
        ) : (
          <div className="settings-empty">
            Aucun compte connecté. Saisis l'URL de ton instance GitLab et un
            Personal Access Token (scope <code>read_api</code>) ci-dessous.
          </div>
        )}
      </SettingsSection>

      <SettingsSection title={connected ? 'Mettre à jour les identifiants' : 'Identifiants'}>
        <div className="settings-credentials">
          <label className="settings-field">
            <span className="settings-field-label">URL de l'instance</span>
            <input
              type="text"
              className="settings-field-input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://gitlab.cfast.fr"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label className="settings-field">
            <span className="settings-field-label">Personal Access Token</span>
            <input
              type="password"
              className="settings-field-input"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={connected ? 'Laisse vide pour conserver le token actuel' : 'glpat-…'}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <div className="gl-settings-actions">
            <button
              type="button"
              className="settings-link-btn"
              disabled={!canSubmit}
              onClick={() => void handleTest()}
            >
              {busy === 'test' ? 'Test…' : 'Tester'}
            </button>
            <button
              type="button"
              className="settings-link-btn primary"
              disabled={!canSubmit}
              onClick={() => void handleConnect()}
            >
              {busy === 'save' ? 'Connexion…' : connected ? 'Mettre à jour' : 'Connecter'}
            </button>
          </div>
          <div className="settings-credentials-hint">
            Le token est chiffré localement via le keystore Windows (DPAPI)
            avant d'être stocké. Crée-le depuis ton profil GitLab :{' '}
            <strong>User settings → Access tokens</strong>. Scope minimal{' '}
            <code>read_api</code>.
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Notifications">
        <SettingsToggleRow
          icon="fa-solid fa-code-merge"
          iconColor="#FC6D26"
          label="Nouvelle review demandée"
          description="Toast quand une MR vient d'être assignée à mon compte."
          value={cfg.notify.mr}
          onChange={(next) =>
            void patchModuleConfig('gitlab', {
              notify: { ...cfg.notify, mr: next },
            })
          }
        />
        <SettingsToggleRow
          icon="fa-solid fa-circle-exclamation"
          iconColor="#ef4444"
          label="Nouvelle issue surveillée"
          description="Toast quand une issue avec un label surveillé (ci-dessous) est créée."
          value={cfg.notify.watchedIssues}
          onChange={(next) =>
            void patchModuleConfig('gitlab', {
              notify: { ...cfg.notify, watchedIssues: next },
            })
          }
        />
      </SettingsSection>

      <SettingsSection title="Labels surveillés">
        <WatchedLabelsField />
      </SettingsSection>

      <SettingsSection title="Comportement">
        <SettingsToggleRow
          icon="fa-solid fa-minimize"
          iconColor="#FC6D26"
          label="Afficher la chip dans le notch rétracté"
          description="Badge avec le nombre de MR à reviewer. Si désactivé, GitLab est visible uniquement dans le dashboard étendu."
          value={cfg.collapsed}
          onChange={(next) =>
            void patchModuleConfig('gitlab', { collapsed: next })
          }
        />
        <SettingsSliderRow
          icon="fa-solid fa-clock-rotate-left"
          iconColor="#FC6D26"
          label="Fréquence de polling"
          description="Intervalle entre deux requêtes à l'API GitLab."
          value={cfg.pollSec}
          min={30}
          max={600}
          step={30}
          formatValue={(v) => (v >= 60 ? `${Math.round(v / 60)} min` : `${v} s`)}
          onChange={(v) => void patchModuleConfig('gitlab', { pollSec: v })}
        />
      </SettingsSection>
    </>
  );
}

/**
 * Champ de saisie multi-lignes pour les labels GitLab à surveiller.
 * Un label par ligne, on commit au blur — pas d'IPC à chaque keystroke.
 *
 * Les labels sont stockés tels quels (incluant `::`, espaces internes).
 * Le filtre `labels=` de l'API GitLab fait une égalité stricte.
 */
function WatchedLabelsField() {
  const { settings, patchModuleConfig } = useSettingsContext();
  const cfg = settings.moduleConfig.gitlab;
  const [text, setText] = useState(cfg.watchedLabels.join('\n'));
  // Dirty flag : protège contre un commit `onBlur` fantôme déclenché par
  // un re-render du context (qui réécrit `text` via l'effet ci-dessous)
  // alors que l'utilisateur n'a jamais touché au textarea. Sans ce garde,
  // un blur dans cette fenêtre persisterait une liste vide.
  const dirtyRef = useRef(false);

  useEffect(() => {
    setText(cfg.watchedLabels.join('\n'));
    dirtyRef.current = false;
  }, [cfg.watchedLabels]);

  const commit = () => {
    if (!dirtyRef.current) return;
    const labels = text
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    // Dédup en gardant l'ordre.
    const seen = new Set<string>();
    const dedup = labels.filter((l) => {
      if (seen.has(l)) return false;
      seen.add(l);
      return true;
    });
    dirtyRef.current = false;
    void patchModuleConfig('gitlab', { watchedLabels: dedup });
  };

  return (
    <div className="settings-credentials">
      <label className="settings-field">
        <span className="settings-field-label">
          Un label par ligne (ex. <code>Severity::Critique</code>)
        </span>
        <textarea
          className="settings-field-input settings-field-textarea"
          value={text}
          onChange={(e) => {
            dirtyRef.current = true;
            setText(e.target.value);
          }}
          onBlur={commit}
          placeholder={'Severity::Critique\nSeverity::Bloquant'}
          rows={4}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <div className="settings-credentials-hint">
        Le filtre est appliqué côté GitLab à l'identique — les{' '}
        <code>::</code> font partie du nom du label. Seules les issues{' '}
        <strong>ouvertes et non assignées</strong> correspondant à au
        moins un label apparaissent dans la card et déclenchent un toast
        à leur création (une fois prises en charge, elles disparaissent).
      </div>
    </div>
  );
}

/* ───────────── Claude Code ───────────── */
function ClaudeSettings() {
  const { settings, patchModuleConfig } = useSettingsContext();
  const { push: pushToast } = useToast();
  const cfg = settings.moduleConfig.claude;
  return (
    <>
      <SettingsSection title="Affichage">
        <SettingsToggleRow
          icon="fa-solid fa-table-columns"
          iconColor="#a78bfa"
          label="Afficher la card dans le dashboard"
          description="La card avec les sessions actives apparaît dans le dashboard étendu. Désactive pour un mode « notifications seulement » : les toasts continuent à être émis."
          value={cfg.showCard}
          onChange={(next) =>
            void patchModuleConfig('claude', { showCard: next })
          }
        />
        <SettingsToggleRow
          icon="fa-solid fa-minimize"
          iconColor="#a78bfa"
          label="Afficher la chip dans le notch rétracté"
          description="Badge + spark coloré indiquant les sessions actives. Si désactivé, les sessions Claude sont invisibles dans le notch fermé."
          value={cfg.collapsed}
          onChange={(next) =>
            void patchModuleConfig('claude', { collapsed: next })
          }
        />
      </SettingsSection>

      <SettingsSection title="Notifications">
        <SettingsToggleRow
          icon="fa-solid fa-check"
          iconColor="#34d399"
          label="Fin de tâche"
          description="Toast quand une session Claude se termine."
          value={cfg.notifyCompletion}
          onChange={(next) =>
            void patchModuleConfig('claude', { notifyCompletion: next })
          }
        />
        <SettingsToggleRow
          icon="fa-solid fa-triangle-exclamation"
          iconColor="#ef4444"
          label="Erreurs"
          value={cfg.notifyError}
          onChange={(next) =>
            void patchModuleConfig('claude', { notifyError: next })
          }
        />
      </SettingsSection>

      <SettingsSection title="Workspaces surveillés">
        <div className="settings-empty">
          Détection automatique via le file watcher sur{' '}
          <code>~/.claude/projects/</code>. Toutes les sessions Claude Code
          actives apparaissent ici sans configuration supplémentaire.
        </div>
      </SettingsSection>

      <SettingsSection title="Test">
        <SettingsRow
          icon="fa-solid fa-vial"
          iconColor="#a78bfa"
          label="Déclencher un toast factice"
          description="Vérifie que la chaîne de notification fonctionne (n'affecte aucune session réelle)."
          right={
            <button
              type="button"
              className="settings-link-btn"
              onClick={() =>
                pushToast({
                  icon: 'fa-solid fa-sparkles',
                  iconColor: 'var(--accent-violet)',
                  name: 'Claude',
                  message: 'Session terminée (test)',
                })
              }
            >
              Tester
            </button>
          }
        />
      </SettingsSection>
    </>
  );
}

/* ───────────── Git local ───────────── */
function GitLocalSettings() {
  const { settings, patchModuleConfig } = useSettingsContext();
  const cfg = settings.moduleConfig.gitlocal;

  return (
    <>
      <SettingsSection title="Dossiers racines">
        <GitLocalRootDirsField />
      </SettingsSection>

      <SettingsSection title="Scan">
        <SettingsSliderRow
          icon="fa-solid fa-magnifying-glass"
          iconColor="#f97316"
          label="Profondeur du scan"
          description="Niveaux de sous-dossiers explorés sous chaque racine. Plafonné à 6 — ne dépasse pas en mode racine de disque."
          value={cfg.scanDepth}
          min={1}
          max={6}
          step={1}
          formatValue={(v) => `${v} niveau${v > 1 ? 'x' : ''}`}
          onChange={(v) => void patchModuleConfig('gitlocal', { scanDepth: v })}
        />
        <GitLocalIgnoreField />
      </SettingsSection>

      <SettingsSection title="Comportement">
        <SettingsToggleRow
          icon="fa-solid fa-minimize"
          iconColor="#f97316"
          label="Afficher la chip dans le notch rétracté"
          description="Badge avec le nombre de repos « à pousser » (uncommitted ou ahead). Si désactivé, Git local est visible uniquement dans le dashboard."
          value={cfg.collapsed}
          onChange={(next) =>
            void patchModuleConfig('gitlocal', { collapsed: next })
          }
        />
        <SettingsSliderRow
          icon="fa-solid fa-clock-rotate-left"
          iconColor="#f97316"
          label="Fréquence de rescan"
          description="Intervalle entre deux scans complets (statut git de chaque repo)."
          value={cfg.pollSec}
          min={15}
          max={600}
          step={15}
          formatValue={(v) => (v >= 60 ? `${Math.round(v / 60)} min` : `${v} s`)}
          onChange={(v) => void patchModuleConfig('gitlocal', { pollSec: v })}
        />
      </SettingsSection>
    </>
  );
}

/**
 * Champ multi-lignes pour les dossiers racines à scanner.
 * Un chemin par ligne, commit au blur — pas d'IPC à chaque keystroke.
 */
function GitLocalRootDirsField() {
  const { settings, patchModuleConfig } = useSettingsContext();
  const cfg = settings.moduleConfig.gitlocal;
  const [text, setText] = useState(cfg.rootDirs.join('\n'));
  // Dirty flag : sans ce garde, un blur déclenché pendant que le store
  // n'a pas encore livré ses vraies valeurs (état initial =
  // DEFAULT_SETTINGS dans SettingsContext) committait `rootDirs: []` et
  // écrasait silencieusement la config — c'est le bug qui a fait
  // disparaître la liste après un redémarrage.
  const dirtyRef = useRef(false);

  useEffect(() => {
    setText(cfg.rootDirs.join('\n'));
    dirtyRef.current = false;
  }, [cfg.rootDirs]);

  const commit = async () => {
    if (!dirtyRef.current) return;
    const dirs = text
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const seen = new Set<string>();
    const dedup = dirs.filter((d) => {
      const key = d.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    dirtyRef.current = false;
    await patchModuleConfig('gitlocal', { rootDirs: dedup });
    // Le service main a son propre Store ; `onDidChange` n'est pas partagé
    // entre instances, donc on force ici un refresh pour avoir le scan
    // tout de suite (sinon il faut attendre le prochain tick de polling).
    void window.notch.gitlocal.refresh();
  };

  return (
    <div className="settings-credentials">
      <label className="settings-field">
        <span className="settings-field-label">
          Un dossier par ligne (ex. <code>C:\Projets</code>)
        </span>
        <textarea
          className="settings-field-input settings-field-textarea"
          value={text}
          onChange={(e) => {
            dirtyRef.current = true;
            setText(e.target.value);
          }}
          onBlur={commit}
          placeholder={'C:\\Projets\nD:\\dev'}
          rows={3}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <div className="settings-credentials-hint">
        Chaque dossier est scanné récursivement jusqu'à la profondeur
        configurée pour trouver les sous-dossiers contenant un{' '}
        <code>.git</code>. Le scan ne descend pas dans un repo une fois
        trouvé — pas de double-comptage avec les submodules.
      </div>
    </div>
  );
}

/** Champ multi-lignes pour les noms de dossiers à ignorer pendant le scan. */
function GitLocalIgnoreField() {
  const { settings, patchModuleConfig } = useSettingsContext();
  const cfg = settings.moduleConfig.gitlocal;
  const [text, setText] = useState(cfg.ignorePatterns.join('\n'));
  // Voir GitLocalRootDirsField pour le rationale du dirty flag.
  const dirtyRef = useRef(false);

  useEffect(() => {
    setText(cfg.ignorePatterns.join('\n'));
    dirtyRef.current = false;
  }, [cfg.ignorePatterns]);

  const commit = async () => {
    if (!dirtyRef.current) return;
    const patterns = text
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const seen = new Set<string>();
    const dedup = patterns.filter((p) => {
      const key = p.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    dirtyRef.current = false;
    await patchModuleConfig('gitlocal', { ignorePatterns: dedup });
    void window.notch.gitlocal.refresh();
  };

  return (
    <div className="settings-credentials">
      <label className="settings-field">
        <span className="settings-field-label">
          Dossiers ignorés pendant le scan (comparaison case-insensitive)
        </span>
        <textarea
          className="settings-field-input settings-field-textarea"
          value={text}
          onChange={(e) => {
            dirtyRef.current = true;
            setText(e.target.value);
          }}
          onBlur={commit}
          placeholder={'node_modules\ndist\nbin'}
          rows={3}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <div className="settings-credentials-hint">
        Les dossiers cachés (commençant par <code>.</code>) sont déjà
        ignorés automatiquement. Ajoute ici les dossiers volumineux où il
        est inutile de chercher (ex. <code>node_modules</code>).
      </div>
    </div>
  );
}

/* ───────────── Messages (stub backend) ───────────── */
function MessagesSettings() {
  const { settings, patchModuleConfig } = useSettingsContext();
  const cfg = settings.moduleConfig.messages;
  return (
    <>
      <SettingsSection title="Services">
        <div className="settings-empty">
          Connexion aux services (WhatsApp, Messenger, SMS, Telegram, Signal,
          Discord…) à venir dans le module dédié.
        </div>
      </SettingsSection>

      <SettingsSection title="Affichage">
        <SettingsToggleRow
          icon="fa-solid fa-eye"
          iconColor="#60a5fa"
          label="Aperçu du message"
          description="Affiche les premiers mots dans la liste."
          value={cfg.showPreview}
          onChange={(next) =>
            void patchModuleConfig('messages', { showPreview: next })
          }
        />
        <SettingsToggleRow
          icon="fa-solid fa-check-double"
          iconColor="#60a5fa"
          label="Marquer comme lu à l'ouverture"
          value={cfg.markReadOnOpen}
          onChange={(next) =>
            void patchModuleConfig('messages', { markReadOnOpen: next })
          }
        />
      </SettingsSection>
    </>
  );
}

/* ───────────── Clipboard ───────────── */
function ClipboardSettings() {
  const { settings, patchModuleConfig } = useSettingsContext();
  const { push: pushToast } = useToast();
  const cfg = settings.moduleConfig.clipboard;

  const handleClearAll = async () => {
    if (!confirm("Vider tout l'historique du presse-papier (épinglés inclus) ?")) {
      return;
    }
    await window.notch.clipboard.clear(false);
    pushToast({
      icon: 'fa-solid fa-broom',
      iconColor: '#a78bfa',
      name: 'Clipboard',
      message: 'Historique vidé',
    });
  };

  return (
    <>
      <SettingsSection title="Affichage">
        <SettingsToggleRow
          icon="fa-solid fa-minimize"
          iconColor="#a78bfa"
          label="Afficher la chip dans le notch rétracté"
          description="Aperçu du dernier élément copié + badge des nouveautés."
          value={cfg.collapsed}
          onChange={(next) =>
            void patchModuleConfig('clipboard', { collapsed: next })
          }
        />
      </SettingsSection>

      <SettingsSection title="Comportement">
        <SettingsSliderRow
          icon="fa-solid fa-clock-rotate-left"
          iconColor="#a78bfa"
          label="Taille maximale de l'historique"
          description="Au-delà, les plus anciens non-épinglés sont supprimés. Les épinglés sont conservés sans limite."
          value={cfg.maxItems}
          min={10}
          max={200}
          step={10}
          formatValue={(v) => `${v} entrées`}
          onChange={(v) => void patchModuleConfig('clipboard', { maxItems: v })}
        />
        <SettingsToggleRow
          icon="fa-solid fa-globe"
          iconColor="#a78bfa"
          label="Aperçu des URLs (titre + favicon)"
          description="Récupère le titre de la page et le favicon en arrière-plan quand tu copies une URL. Désactive si tu préfères éviter tout fetch HTTP."
          value={cfg.enableUnfurl}
          onChange={(next) =>
            void patchModuleConfig('clipboard', { enableUnfurl: next })
          }
        />
        <SettingsToggleRow
          icon="fa-solid fa-eye-slash"
          iconColor="#a78bfa"
          label="Masquer les secrets détectés"
          description="Les tokens, mots de passe et chaînes opaques longues sont masqués par défaut (clic « Révéler » pour afficher)."
          value={cfg.maskSensitive}
          onChange={(next) =>
            void patchModuleConfig('clipboard', { maskSensitive: next })
          }
        />
      </SettingsSection>

      <SettingsSection title="Sécurité">
        <div className="settings-empty">
          L'historique est chiffré localement via le keystore Windows (DPAPI)
          avant d'être persisté. Les images sont stockées en clair dans{' '}
          <code>%APPDATA%/winnotch/clipboard-images/</code> (cleanup automatique
          quand une entrée est évincée).
        </div>
      </SettingsSection>

      <SettingsSection title="Données">
        <SettingsRow
          icon="fa-solid fa-trash"
          iconColor="#ef4444"
          label="Vider l'historique"
          description="Supprime toutes les entrées (épinglés compris) et les PNG associés."
          right={
            <button
              type="button"
              className="settings-link-btn"
              onClick={() => void handleClearAll()}
            >
              Vider
            </button>
          }
        />
      </SettingsSection>
    </>
  );
}
