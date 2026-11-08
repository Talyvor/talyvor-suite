import { createContext, forwardRef, useContext, useId } from 'react'
import { cn } from '../lib/cn'

export interface FieldProps {
  label: React.ReactNode
  /** One Input or one Select, which the label names. */
  children: React.ReactNode
  className?: string
}

/** The id a Field's label points at; its Input or Select takes it unless given its own. */
const FieldId = createContext<string | undefined>(undefined)

// pocket.css .field: the label above its control. The label points at the control by id rather than wrapping
// it, so a unit beside the value is not read as part of the field's name.
export function Field({ label, children, className }: FieldProps) {
  const id = useId()
  return (
    <div className={cn('grid gap-1.5', className)}>
      <label htmlFor={id} className="text-body font-semibold text-ink-2">
        {label}
      </label>
      <FieldId.Provider value={id}>{children}</FieldId.Provider>
    </div>
  )
}

// pocket.css .input: 46 tall, 14 round, the page with the 1.5px control edge. The ring is drawn on the box, so
// a unit beside the value sits inside it.
// py-0.5 keeps the value's own fill off the 1.5px edge, which is painted inside the box.
const box = 'flex h-11.5 items-center gap-2 rounded-control bg-page px-3.5 py-0.5 text-reading text-ink shadow-edge'
const boxRing = 'focus-within:outline focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-tangerine'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** The value's unit, faint beside it: USD, LXC, %. */
  unit?: React.ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ unit, className, type = 'text', id, ...props }, ref) {
  const fieldId = useContext(FieldId)
  return (
    <span className={cn(box, boxRing, 'has-[:disabled]:opacity-50', className)}>
      <input
        ref={ref}
        id={id ?? fieldId}
        type={type}
        className="h-full min-w-0 flex-1 bg-page font-figure text-ink outline-none placeholder:text-faint disabled:cursor-not-allowed"
        {...props}
      />
      {unit ? <span className="shrink-0 text-ink-3">{unit}</span> : null}
    </span>
  )
})

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>

/** Pocket's Select: the browser's own list (the phone's wheel on a phone) in the same box as an Input. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, id, children, ...props }, ref) {
  const fieldId = useContext(FieldId)
  return (
    <span className={cn(box, boxRing, 'relative has-[:disabled]:opacity-50', className)}>
      <select
        ref={ref}
        id={id ?? fieldId}
        className="h-full min-w-0 flex-1 cursor-pointer appearance-none bg-page pr-6 font-figure text-ink outline-none disabled:cursor-not-allowed"
        {...props}
      >
        {children}
      </select>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute right-3.5 h-4 w-4 fill-none stroke-current text-ink-3" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 10l5 5 5-5" />
      </svg>
    </span>
  )
})
