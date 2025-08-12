import * as React from "react"
import { Calendar as CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface DatePickerProps {
  date?: Date
  onDateChange: (date: Date | undefined) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function DatePicker({ 
  date, 
  onDateChange, 
  placeholder = "Pick a date",
  disabled = false,
  className
}: DatePickerProps) {
  const [inputValue, setInputValue] = React.useState(
    date ? date.toISOString().split('T')[0] : ''
  )

  React.useEffect(() => {
    setInputValue(date ? date.toISOString().split('T')[0] : '')
  }, [date])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputValue(value)
    if (value) {
      const newDate = new Date(value + 'T00:00:00.000Z')
      onDateChange(newDate)
    } else {
      onDateChange(undefined)
    }
  }

  const formatDisplayDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short', 
      day: 'numeric'
    })
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={"outline"}
          className={cn(
            "w-full justify-start text-left font-normal",
            !date && "text-muted-foreground",
            className
          )}
          disabled={disabled}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? formatDisplayDate(date) : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4">
        <div className="space-y-4">
          <h4 className="font-medium leading-none">Select Date</h4>
          <Input
            type="date"
            value={inputValue}
            onChange={handleInputChange}
            className="w-full"
          />
          {date && (
            <div className="text-sm text-muted-foreground">
              Selected: {formatDisplayDate(date)}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}