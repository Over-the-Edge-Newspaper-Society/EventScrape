import { ExternalLink } from 'lucide-react'
import { isValidElement, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type StructuredFieldType = 'text' | 'link' | 'list' | 'multiline'

export type StructuredFieldValue =
  | ReactNode
  | string
  | number
  | boolean
  | string[]
  | null
  | undefined

export type StructuredField = {
  key: string
  label: string
  value: StructuredFieldValue
  type?: StructuredFieldType
  labelClassName?: string
  valueClassName?: string
}

type StructuredFieldListProps = {
  fields: StructuredField[]
  className?: string
}

export function StructuredFieldList({ fields, className }: StructuredFieldListProps) {
  if (!fields.length) {
    return null
  }

  return (
    <div className={cn('space-y-3', className)}>
      {fields.map((field) => (
        <div
          key={field.key}
          className="grid grid-cols-4 gap-4 border-b border-muted-foreground/10 pb-2 last:border-b-0 last:pb-0"
        >
          <div className={cn('font-medium text-foreground', field.labelClassName)}>{field.label}:</div>
          <div className={cn('col-span-3 break-words text-sm', field.valueClassName)}>
            {renderFieldValue(field)}
          </div>
        </div>
      ))}
    </div>
  )
}

const renderFieldValue = (field: StructuredField): ReactNode => {
  const { value, type } = field

  if (value === null || value === undefined) {
    return notProvided()
  }

  if (isValidElement(value)) {
    return value
  }

  if (typeof value === 'string') {
    if (value.trim().length === 0) {
      return notProvided()
    }

    if (type === 'multiline') {
      return <p className="whitespace-pre-wrap">{value}</p>
    }

    if (type === 'link') {
      return (
        <a href={value} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
          {value}
          <ExternalLink className="ml-1 inline h-3 w-3" />
        </a>
      )
    }

    return value
  }

  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }

  if (Array.isArray(value)) {
    if (!value.length) {
      return notProvided()
    }

    if (type === 'list') {
      return (
        <ul className="space-y-1">
          {value.map((entry, index) => (
            <li key={`${field.key}-${index}`} className="font-mono text-xs text-muted-foreground">
              {entry}
            </li>
          ))}
        </ul>
      )
    }

    return value.join(', ')
  }

  return value
}

const notProvided = () => <span className="italic text-muted-foreground">Not provided</span>
