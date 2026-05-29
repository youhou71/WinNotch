/**
 * Composants atomiques pour la page Settings.
 *
 * Patterns issus du prototype (notch-settings.jsx) :
 *  - SettingsSection : titre + bloc avec rows
 *  - SettingsRow : ligne générique (icône + label + sous-titre + slot droit)
 *  - SettingsToggleRow : ligne avec switch iOS
 *  - SettingsSliderRow : ligne avec slider blanc + valeur tabular
 *  - SettingsRadioRow : ligne avec radio pills
 *
 * Le style suit l'esthétique Windows 11 (rows sombres, switch animé,
 * icônes tintées sur fond léger).
 */
import type { ReactNode } from 'react';

/* ───────────── Section (titre + container) ───────────── */

interface SectionProps {
  title?: string;
  /** Sous-titre gris affiché sous le titre — typiquement pour décrire une famille de modules. */
  description?: string;
  children: ReactNode;
}

export function SettingsSection({ title, description, children }: SectionProps) {
  return (
    <div className="settings-section">
      {title && <div className="settings-section-title">{title}</div>}
      {description && (
        <div className="settings-section-desc">{description}</div>
      )}
      <div className="settings-section-body">{children}</div>
    </div>
  );
}

/* ───────────── Row générique ───────────── */

interface RowProps {
  /** Classe Font Awesome complète (ex. "fa-solid fa-music"). */
  icon?: string;
  /** Couleur de tint pour l'icône (background + foreground). */
  iconColor?: string;
  /** Libellé principal. */
  label: string;
  /** Sous-titre gris en dessous (optionnel). */
  description?: string;
  /** Slot droit (toggle, slider, chevron, etc.). */
  right?: ReactNode;
  /** Si fourni, la row entière devient cliquable. */
  onClick?: () => void;
}

export function SettingsRow({
  icon,
  iconColor,
  label,
  description,
  right,
  onClick,
}: RowProps) {
  const interactive = !!onClick;
  return (
    <div
      className={'settings-row' + (interactive ? ' is-interactive' : '')}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      {icon && (
        <div
          className="settings-row-icon"
          style={
            iconColor
              ? { background: iconColor + '22', color: iconColor }
              : undefined
          }
        >
          <i className={icon} />
        </div>
      )}
      <div className="settings-row-body">
        <div className="settings-row-label">{label}</div>
        {description && (
          <div className="settings-row-desc">{description}</div>
        )}
      </div>
      {right && <div className="settings-row-right">{right}</div>}
    </div>
  );
}

/* ───────────── Toggle (switch iOS) ───────────── */

interface ToggleProps {
  value: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
}

export function SettingsToggle({ value, onChange, ariaLabel }: ToggleProps) {
  return (
    <button
      type="button"
      className={'settings-toggle' + (value ? ' is-on' : '')}
      onClick={(e) => {
        // stopPropagation pour ne pas déclencher le clic de la row parente
        // (si la row est interactive elle aussi).
        e.stopPropagation();
        onChange(!value);
      }}
      role="switch"
      aria-checked={value}
      aria-label={ariaLabel}
    >
      <span className="settings-toggle-knob" />
    </button>
  );
}

interface ToggleRowProps extends Omit<RowProps, 'right' | 'onClick'> {
  value: boolean;
  onChange: (next: boolean) => void;
}

export function SettingsToggleRow({
  value,
  onChange,
  ...row
}: ToggleRowProps) {
  return (
    <SettingsRow
      {...row}
      onClick={() => onChange(!value)}
      right={
        <SettingsToggle
          value={value}
          onChange={onChange}
          ariaLabel={row.label}
        />
      }
    />
  );
}

/* ───────────── Slider ───────────── */

interface SliderRowProps extends Omit<RowProps, 'right' | 'onClick'> {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Formate la valeur affichée à droite (ex. "60 s"). */
  formatValue?: (v: number) => string;
  onChange: (next: number) => void;
}

export function SettingsSliderRow({
  value,
  min,
  max,
  step = 1,
  formatValue,
  onChange,
  ...row
}: SliderRowProps) {
  return (
    <SettingsRow
      {...row}
      right={
        <div className="settings-slider-wrap">
          <input
            type="range"
            className="settings-slider"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.currentTarget.value))}
            onClick={(e) => e.stopPropagation()}
          />
          <span className="settings-slider-val">
            {formatValue ? formatValue(value) : value}
          </span>
        </div>
      }
    />
  );
}

/* ───────────── Radio (pills horizontales) ───────────── */

interface RadioOption<T extends string> {
  value: T;
  label: string;
}

interface RadioRowProps<T extends string>
  extends Omit<RowProps, 'right' | 'onClick'> {
  value: T;
  options: RadioOption<T>[];
  onChange: (next: T) => void;
}

export function SettingsRadioRow<T extends string>({
  value,
  options,
  onChange,
  ...row
}: RadioRowProps<T>) {
  return (
    <SettingsRow
      {...row}
      right={
        <div
          className="settings-radio-pills"
          onClick={(e) => e.stopPropagation()}
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                className={'settings-radio-pill' + (active ? ' is-active' : '')}
                onClick={() => onChange(opt.value)}
                aria-pressed={active}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      }
    />
  );
}
