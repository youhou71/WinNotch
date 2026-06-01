/**
 * Page de réglages du module Bambu.
 *
 * Deux modes de connexion (sélecteur en tête) :
 *  - **Réseau local (LAN)** : IP + numéro de série + code d'accès, MQTT direct.
 *  - **Cloud Bambu** : login compte Bambu (avec 2FA email), choix de l'imprimante
 *    dans la liste liée au compte, MQTT via le broker cloud (suivi à distance).
 *
 * Aucun secret n'est relu depuis le main : code d'accès LAN et jeton cloud sont
 * chiffrés (DPAPI). Le mot de passe du compte Bambu n'est jamais stocké.
 */
import { useEffect, useState } from 'react';
import type { BambuCloudDevice } from '../../../shared/types';
import { useSettingsContext } from '../settings/SettingsContext';
import { useToast } from '../toast/ToastContext';
import {
  SettingsRow,
  SettingsSection,
  SettingsToggleRow,
  SettingsRadioRow,
} from '../settings/atoms';

export function BambuSettings() {
  const { settings, patchModuleConfig } = useSettingsContext();
  const cfg = settings.moduleConfig.bambu;

  return (
    <>
      <SettingsSection title="Connexion">
        <SettingsRadioRow
          icon="fa-solid fa-network-wired"
          iconColor="#00ae42"
          label="Mode"
          description="Local : même réseau que l'imprimante. Cloud : suivi à distance via le compte Bambu."
          value={cfg.mode}
          options={[
            { value: 'lan', label: 'Réseau local' },
            { value: 'cloud', label: 'Cloud Bambu' },
          ]}
          onChange={(next) => void window.notch.bambu.setMode(next)}
        />
      </SettingsSection>

      {cfg.mode === 'lan' ? <BambuLanSettings /> : <BambuCloudSettings />}

      <SettingsSection title="Affichage">
        <SettingsToggleRow
          icon="fa-solid fa-print"
          iconColor="#00ae42"
          label="Afficher la chip pendant un print"
          description="Pastille de progression dans le notch rétracté pendant l'impression."
          value={cfg.collapsed}
          onChange={(next) => void patchModuleConfig('bambu', { collapsed: next })}
        />
        <SettingsToggleRow
          icon="fa-solid fa-eye"
          label="Garder la chip hors impression"
          description="Affiche aussi la chip (état connexion) quand aucun print n'est en cours."
          value={cfg.showWhenIdle}
          onChange={(next) =>
            void patchModuleConfig('bambu', { showWhenIdle: next })
          }
        />
        <SettingsToggleRow
          icon="fa-solid fa-table-cells-large"
          label="Afficher la card dans le dashboard"
          value={cfg.showCard}
          onChange={(next) => void patchModuleConfig('bambu', { showCard: next })}
        />
      </SettingsSection>
    </>
  );
}

/* ───────────── Mode LAN ───────────── */

function BambuLanSettings() {
  const { settings } = useSettingsContext();
  const { push: pushToast } = useToast();
  const cfg = settings.moduleConfig.bambu;

  const [host, setHost] = useState(cfg.host);
  const [serial, setSerial] = useState(cfg.serial);
  const [name, setName] = useState(cfg.printerName);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'test' | 'save' | 'clear' | null>(null);

  useEffect(() => {
    setHost(cfg.host);
    setSerial(cfg.serial);
    setName(cfg.printerName);
  }, [cfg.host, cfg.serial, cfg.printerName]);

  const configured = !!cfg.host && !!cfg.serial;

  const notify = (ok: boolean, message: string) =>
    pushToast({
      icon: ok ? 'fa-solid fa-print' : 'fa-solid fa-triangle-exclamation',
      iconColor: ok ? '#00ae42' : '#ef4444',
      name: 'Bambu',
      message,
    });

  const handleTest = async () => {
    setBusy('test');
    try {
      const res = await window.notch.bambu.testConnection(host, serial, code);
      notify(res.ok, res.ok ? 'Connexion réussie' : res.error ?? 'Échec');
    } finally {
      setBusy(null);
    }
  };

  const handleSave = async () => {
    setBusy('save');
    try {
      const res = await window.notch.bambu.saveCredentials(host, serial, code, name);
      if (res.ok) {
        setCode('');
        notify(true, 'Imprimante enregistrée');
      } else {
        notify(false, res.error ?? 'Enregistrement impossible');
      }
    } finally {
      setBusy(null);
    }
  };

  const handleDisconnect = async () => {
    setBusy('clear');
    try {
      await window.notch.bambu.disconnect();
      setCode('');
      notify(true, 'Imprimante déconnectée');
    } finally {
      setBusy(null);
    }
  };

  const canSave =
    !!host.trim() &&
    !!serial.trim() &&
    (!!code.trim() || !!cfg.encryptedAccessCode) &&
    !busy;
  const canTest = !!host.trim() && !!serial.trim() && !!code.trim() && !busy;

  return (
    <>
      <SettingsSection title="Imprimante">
        {configured ? (
          <SettingsRow
            icon="fa-solid fa-print"
            iconColor="#00ae42"
            label={cfg.printerName || 'Imprimante Bambu'}
            description={`${cfg.host} · ${cfg.serial}`}
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
            Aucune imprimante connectée. Active le <strong>mode LAN</strong>{' '}
            sur l'écran de l'imprimante, puis renseigne son IP, son numéro de
            série et le code d'accès ci-dessous.
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title={configured ? 'Mettre à jour la connexion' : 'Connexion LAN'}
      >
        <div className="settings-credentials">
          <label className="settings-field">
            <span className="settings-field-label">Nom (optionnel)</span>
            <input
              type="text"
              className="settings-field-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="P1S atelier"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label className="settings-field">
            <span className="settings-field-label">Adresse IP</span>
            <input
              type="text"
              className="settings-field-input"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.1.42"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label className="settings-field">
            <span className="settings-field-label">Numéro de série</span>
            <input
              type="text"
              className="settings-field-input"
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="01P00A1234567890"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label className="settings-field">
            <span className="settings-field-label">Code d'accès</span>
            <input
              type="password"
              className="settings-field-input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={
                cfg.encryptedAccessCode
                  ? 'Laisse vide pour conserver le code actuel'
                  : '8 chiffres (écran imprimante)'
              }
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <div className="gl-settings-actions">
            <button
              type="button"
              className="settings-link-btn"
              disabled={!canTest}
              onClick={() => void handleTest()}
            >
              {busy === 'test' ? 'Test…' : 'Tester'}
            </button>
            <button
              type="button"
              className="settings-link-btn primary"
              disabled={!canSave}
              onClick={() => void handleSave()}
            >
              {busy === 'save'
                ? 'Enregistrement…'
                : configured
                  ? 'Mettre à jour'
                  : 'Enregistrer'}
            </button>
          </div>
          <div className="settings-credentials-hint">
            Le code d'accès est chiffré localement via le keystore Windows
            (DPAPI). Active <strong>Réglages → Général → Mode LAN</strong> sur
            l'imprimante. Module en lecture seule (aucune commande envoyée).
          </div>
        </div>
      </SettingsSection>
    </>
  );
}

/* ───────────── Mode Cloud ───────────── */

function BambuCloudSettings() {
  const { settings } = useSettingsContext();
  const { push: pushToast } = useToast();
  const cfg = settings.moduleConfig.bambu;

  const [region, setRegion] = useState<'global' | 'china'>(cfg.region);
  const [email, setEmail] = useState(cfg.email);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<'idle' | 'code' | 'devices'>('idle');
  const [devices, setDevices] = useState<BambuCloudDevice[]>([]);
  const [busy, setBusy] = useState(false);
  // Méthode de connexion : code email (par défaut — compatible Google/Apple)
  // ou mot de passe (option secondaire, pour les comptes qui en ont un).
  const [usePassword, setUsePassword] = useState(false);

  useEffect(() => {
    setEmail(cfg.email);
    setRegion(cfg.region);
  }, [cfg.email, cfg.region]);

  const connected = !!cfg.cloudAuthEnc && !!cfg.serial;

  const notify = (ok: boolean, message: string) =>
    pushToast({
      icon: ok ? 'fa-solid fa-cloud' : 'fa-solid fa-triangle-exclamation',
      iconColor: ok ? '#00ae42' : '#ef4444',
      name: 'Bambu',
      message,
    });

  // Flux principal : envoi d'un code par email (sans mot de passe).
  const handleRequestCode = async () => {
    setBusy(true);
    try {
      const res = await window.notch.bambu.cloudRequestCode(email, region);
      if (res.ok) {
        setPhase('code');
        notify(true, 'Code de connexion envoyé par email');
      } else {
        notify(false, res.error ?? 'Envoi du code impossible');
      }
    } catch (err) {
      notify(false, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Flux secondaire : connexion par mot de passe (comptes qui en ont un).
  const handleLogin = async () => {
    setBusy(true);
    try {
      const res = await window.notch.bambu.cloudLogin(email, password, region);
      if (res.needCode) {
        setPhase('code');
        notify(true, 'Code de vérification envoyé par email');
      } else if (res.ok) {
        setPassword('');
        setDevices(res.devices ?? []);
        setPhase('devices');
      } else {
        notify(false, res.error ?? 'Connexion impossible');
      }
    } catch (err) {
      notify(false, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitCode = async () => {
    setBusy(true);
    try {
      const res = await window.notch.bambu.cloudSubmitCode(email, code, region);
      if (res.ok) {
        setCode('');
        setPassword('');
        setDevices(res.devices ?? []);
        setPhase('devices');
      } else {
        notify(false, res.error ?? 'Code invalide');
      }
    } catch (err) {
      notify(false, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSelectDevice = async (d: BambuCloudDevice) => {
    setBusy(true);
    try {
      await window.notch.bambu.cloudSelectDevice(d.serial, d.name);
      notify(true, `Imprimante « ${d.name} » sélectionnée`);
      setPhase('idle');
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    try {
      await window.notch.bambu.disconnect();
      setPhase('idle');
      setDevices([]);
      setPassword('');
      setCode('');
      notify(true, 'Compte Bambu déconnecté');
    } finally {
      setBusy(false);
    }
  };

  // Déjà connecté à une imprimante cloud.
  if (connected) {
    return (
      <SettingsSection title="Compte Bambu (cloud)">
        <SettingsRow
          icon="fa-solid fa-cloud"
          iconColor="#00ae42"
          label={cfg.deviceName || 'Imprimante cloud'}
          description={`${cfg.email} · ${region === 'china' ? 'Chine' : 'Global'}`}
          right={
            <button
              type="button"
              className="settings-link-btn"
              disabled={busy}
              onClick={() => void handleLogout()}
            >
              {busy ? 'En cours…' : 'Se déconnecter'}
            </button>
          }
        />
      </SettingsSection>
    );
  }

  return (
    <>
      <SettingsSection title="Compte Bambu (cloud)">
        <SettingsRadioRow
          icon="fa-solid fa-globe"
          label="Région"
          value={region}
          options={[
            { value: 'global', label: 'Global / Europe' },
            { value: 'china', label: 'Chine' },
          ]}
          onChange={(next) => setRegion(next)}
        />
        <div className="settings-credentials">
          <label className="settings-field">
            <span className="settings-field-label">Email du compte Bambu</span>
            <input
              type="email"
              className="settings-field-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="toi@exemple.com"
              spellCheck={false}
              autoComplete="off"
              disabled={phase === 'code'}
            />
          </label>

          {/* Flux secondaire : mot de passe (si l'utilisateur en a un). */}
          {phase !== 'code' && usePassword && (
            <label className="settings-field">
              <span className="settings-field-label">Mot de passe</span>
              <input
                type="password"
                className="settings-field-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="mot de passe Bambu"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
          )}

          {phase === 'code' && (
            <label className="settings-field">
              <span className="settings-field-label">Code de connexion</span>
              <input
                type="text"
                className="settings-field-input"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="code reçu par email"
                spellCheck={false}
                autoComplete="off"
                inputMode="numeric"
              />
            </label>
          )}

          <div className="gl-settings-actions">
            {phase === 'code' ? (
              <>
                <button
                  type="button"
                  className="settings-link-btn"
                  disabled={busy || !email.trim()}
                  onClick={() => void handleRequestCode()}
                >
                  Renvoyer le code
                </button>
                <button
                  type="button"
                  className="settings-link-btn primary"
                  disabled={busy || !code.trim()}
                  onClick={() => void handleSubmitCode()}
                >
                  {busy ? 'Validation…' : 'Valider le code'}
                </button>
              </>
            ) : usePassword ? (
              <button
                type="button"
                className="settings-link-btn primary"
                disabled={busy || !email.trim() || !password.trim()}
                onClick={() => void handleLogin()}
              >
                {busy ? 'Connexion…' : 'Se connecter'}
              </button>
            ) : (
              <button
                type="button"
                className="settings-link-btn primary"
                disabled={busy || !email.trim()}
                onClick={() => void handleRequestCode()}
              >
                {busy ? 'Envoi…' : 'Recevoir un code par email'}
              </button>
            )}
          </div>

          {/* Bascule entre les deux méthodes (hors étape code). */}
          {phase !== 'code' && (
            <button
              type="button"
              className="settings-link-btn bambu-method-toggle"
              disabled={busy}
              onClick={() => setUsePassword((v) => !v)}
            >
              {usePassword
                ? '← Recevoir un code par email à la place'
                : "J'ai un mot de passe Bambu →"}
            </button>
          )}

          <div className="settings-credentials-hint">
            La <strong>connexion par code email</strong> marche pour la plupart
            des comptes (pense à vérifier tes spams). <strong>Compte Google /
            Apple</strong> : si aucun code n'arrive, ajoute un{' '}
            <strong>mot de passe</strong> à ton compte sur bambulab.com, puis
            utilise « J'ai un mot de passe Bambu ». Rien de sensible n'est
            stocké (ni mot de passe, ni code) — seul un jeton chiffré localement
            (DPAPI). L'imprimante doit rester{' '}
            <strong>connectée au cloud Bambu</strong> (le mode « LAN Only »
            strict de l'imprimante coupe le cloud).
          </div>
        </div>
      </SettingsSection>

      {phase === 'devices' && (
        <SettingsSection title="Choisis ton imprimante">
          {devices.length === 0 ? (
            <div className="settings-empty">
              Aucune imprimante trouvée sur ce compte. Vérifie qu'elle est
              allumée et <strong>connectée au cloud</strong> (pas en mode LAN
              Only).
            </div>
          ) : (
            devices.map((d) => (
              <SettingsRow
                key={d.serial}
                icon="fa-solid fa-print"
                iconColor={d.online ? '#00ae42' : '#94a3b8'}
                label={d.name}
                description={`${d.serial} · ${d.online ? 'en ligne' : 'hors ligne'}`}
                right={
                  <button
                    type="button"
                    className="settings-link-btn primary"
                    disabled={busy}
                    onClick={() => void handleSelectDevice(d)}
                  >
                    Choisir
                  </button>
                }
              />
            ))
          )}
        </SettingsSection>
      )}
    </>
  );
}
