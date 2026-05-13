const buildDate = new Date()

const buildDateLabel = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Tokyo',
}).format(buildDate)

export const lastUpdatedLabel = `Last updated ${buildDateLabel} JST`
export const buildDateIso = buildDate.toISOString()
