export type Language = 'en' | 'hi'

const EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const EN_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const HI = ['जन', 'फ़र', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुला', 'अग', 'सित', 'अक्टू', 'नव', 'दिसं']
const HI_LONG = [
  'जनवरी',
  'फ़रवरी',
  'मार्च',
  'अप्रैल',
  'मई',
  'जून',
  'जुलाई',
  'अगस्त',
  'सितंबर',
  'अक्टूबर',
  'नवंबर',
  'दिसंबर',
]

const PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/

export function monthToIndex(month: string): number {
  const match = PATTERN.exec(month)
  if (!match) throw new Error(`Not a YYYY-MM month: ${month}`)
  return Number(match[1]) * 12 + Number(match[2]) - 1
}

export function indexToMonth(index: number): string {
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

export function addMonths(month: string, count: number): string {
  return indexToMonth(monthToIndex(month) + count)
}

export function monthsBetween(from: string, to: string): number {
  return monthToIndex(to) - monthToIndex(from)
}

/** "Jan 2027" or, in Hindi, "जन 2027". */
export function monthLabel(month: string, language: Language): string {
  const index = monthToIndex(month)
  const names = language === 'hi' ? HI : EN
  return `${names[index % 12]} ${Math.floor(index / 12)}`
}

/** "January 2027" or "जनवरी 2027", for sentences. */
export function monthLabelLong(month: string, language: Language): string {
  const index = monthToIndex(month)
  const names = language === 'hi' ? HI_LONG : EN_LONG
  return `${names[index % 12]} ${Math.floor(index / 12)}`
}

export function monthRange(from: string, count: number): string[] {
  return Array.from({ length: count }, (_, step) => addMonths(from, step))
}
