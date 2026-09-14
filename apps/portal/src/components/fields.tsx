export function Field({
  name,
  id,
  label,
  hint,
  error,
  type = 'text',
  defaultValue,
  required,
  autoComplete,
  inputMode,
  maxLength,
  min,
  max,
}: {
  name: string;
  /** Distinct from `name` when a page shows the same field in several forms. */
  id?: string;
  label: string;
  hint?: string;
  error?: string;
  type?: 'text' | 'password' | 'tel' | 'email' | 'number';
  defaultValue?: string | number;
  required?: boolean;
  autoComplete?: string;
  inputMode?: 'text' | 'tel' | 'email' | 'numeric';
  maxLength?: number;
  min?: number;
  max?: number;
}) {
  const controlId = id ?? name;
  const hintId = hint === undefined ? undefined : `${controlId}-hint`;
  const errorId = error === undefined ? undefined : `${controlId}-error`;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label className="label" htmlFor={controlId}>
        {label}
        {required === true ? null : <span className="muted small"> (optional)</span>}
      </label>
      {hint === undefined ? null : (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      )}
      <input
        id={controlId}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        min={min}
        max={max}
        aria-describedby={describedBy}
        aria-invalid={error === undefined ? undefined : true}
      />
      {error === undefined ? null : (
        <span className="field-error" id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}

export function TextArea({
  name,
  id,
  label,
  hint,
  error,
  defaultValue,
  required,
  maxLength,
}: {
  name: string;
  /** Distinct from `name` when a page shows the same field in several forms. */
  id?: string;
  label: string;
  hint?: string;
  error?: string;
  defaultValue?: string;
  required?: boolean;
  maxLength?: number;
}) {
  const controlId = id ?? name;
  const hintId = hint === undefined ? undefined : `${controlId}-hint`;
  const errorId = error === undefined ? undefined : `${controlId}-error`;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label className="label" htmlFor={controlId}>
        {label}
        {required === true ? null : <span className="muted small"> (optional)</span>}
      </label>
      {hint === undefined ? null : (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      )}
      <textarea
        id={controlId}
        name={name}
        defaultValue={defaultValue}
        required={required}
        maxLength={maxLength}
        aria-describedby={describedBy}
        aria-invalid={error === undefined ? undefined : true}
      />
      {error === undefined ? null : (
        <span className="field-error" id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}

export function Select({
  name,
  id,
  label,
  hint,
  options,
  defaultValue,
  required,
}: {
  name: string;
  /** Distinct from `name` when a page shows the same field in several forms. */
  id?: string;
  label: string;
  hint?: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string;
  required?: boolean;
}) {
  const controlId = id ?? name;
  const hintId = hint === undefined ? undefined : `${controlId}-hint`;
  return (
    <div className="field">
      <label className="label" htmlFor={controlId}>
        {label}
        {required === true ? null : <span className="muted small"> (optional)</span>}
      </label>
      {hint === undefined ? null : (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      )}
      <select
        id={controlId}
        name={name}
        defaultValue={defaultValue}
        required={required}
        aria-describedby={hintId}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
