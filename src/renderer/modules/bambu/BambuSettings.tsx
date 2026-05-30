/**
 * Page de réglages du module Bambu.
 *
 * Saisie des identifiants de connexion LAN (IP + numéro de série + code
 * d'accès) avec test/enregistrement, puis toggles d'affichage. Le code
 * d'accès n'est jamais relu depuis le main (chiffré via DPAPI) : s'il est
 * déjà enregistré, laisser le champ vide le conserve.
 *
 * Calqué sur GitLabSettings (`SettingsModulePage.tsx`).
 */
import { useEffect, useState } from 'react';
import { useSettingsContext } from '../settings/SettingsContext';
import { useToast } from '../toast/ToastContext';
import {
  SettingsRow,
  SettingsSection,
  SettingsToggleRow,
} from '../settings/atoms';

export function BambuSettings() {
  const { settings, patchModuleConfig } = useSettingsContext();
  const { push: pushToast } = useToast();
  const cfg = settings.moduleConfig.bambu;

  const [host, setHost] = useState(cfg.host);
  const [serial, setSerial] = useState(cfg.serial);
  const [name, setName] = useState(cfg.printerName);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'test' | 'save' | 'clear' | null>(null);

  // Re-sync depuis le store si la config change ailleurs (clear, reload…).
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
      const res = await window.notch.bambu.saveCredentials(
        host,
        serial,
        code,
        name,
      );
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

  // Pour enregistrer : IP + serial requis, et un code (nouveau OU déjà stocké).
  const canSave =
    !!host.trim() &&
    !!serial.trim() &&
    (!!code.trim() || !!cfg.encryptedAccessCode) &&
    !busy;
  // Pour tester : il faut un code en clair (le code stocké n'est pas relisible).
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
            (DPAPI) avant d'être stocké. Active <strong>Réglages → Général →
            Mode LAN</strong> sur l'imprimante pour autoriser la connexion
            MQTT locale. Module en lecture seule (aucune commande envoyée).
          </div>
        </div>
      </SettingsSection>

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
