export default defineEventHandler((event) => {
  const host = getRequestHeader(event, 'host')
  if (host?.startsWith('www.')) {
    const newHost = host.replace(/^www\./, '')
    const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https'
    return sendRedirect(event, `${protocol}://${newHost}${event.path}`, 301)
  }
})
