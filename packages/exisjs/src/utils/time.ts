/**
 * Returns a standardized timestamp string formatted as [HH:MM:SS] in 24-hour time.
 * This is the standard log time format for the ExisJS framework.
 */
export function getFormattedTime(): string {
  const now = new Date()
  const hours = now.getHours().toString().padStart(2, '0')
  const minutes = now.getMinutes().toString().padStart(2, '0')
  const seconds = now.getSeconds().toString().padStart(2, '0')
  return `[${hours}:${minutes}:${seconds}]`
}
