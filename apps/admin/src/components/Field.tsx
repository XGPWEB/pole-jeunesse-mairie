'use client';
import { useId, cloneElement, isValidElement, type ReactElement } from 'react';

/**
 * Champ de formulaire accessible : associe automatiquement le libellé au
 * contrôle de saisie.
 *
 * Pourquoi ce composant existe : les formulaires de l'application posaient le
 * `<label>` en simple frère de l'`<input>`, sans `htmlFor`. Résultat, aucun
 * champ n'était annoncé par un lecteur d'écran (« zone d'édition » sans
 * intitulé) et cliquer sur le libellé ne plaçait pas le focus dans le champ.
 * Pour une application municipale, c'est un manquement au RGAA 4.1 / WCAG 2.1
 * critère 3.3.2 (niveau A), juridiquement opposable.
 *
 * L'identifiant est généré par `useId()` : pas d'identifiant à gérer
 * manuellement, et aucun risque de collision entre deux champs de même nom.
 *
 * Usage :
 *   <Field label="Nom de famille" required>
 *     <Input value={form.nom} onChange={…} />
 *   </Field>
 */
export default function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactElement;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  const described = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id,
        // `required` sert au navigateur ET aux technologies d'assistance.
        ...(required ? { required: true, 'aria-required': true } : {}),
        ...(error ? { 'aria-invalid': true } : {}),
        ...(described ? { 'aria-describedby': described } : {}),
      })
    : children;

  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-gray-600 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-1" aria-hidden="true">*</span>}
      </label>
      {control}
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-gray-400">{hint}</p>
      )}
      {error && (
        // role="alert" : l'erreur est annoncée dès son apparition.
        <p id={errorId} role="alert" className="mt-1 text-xs text-red-600 font-medium">{error}</p>
      )}
    </div>
  );
}
