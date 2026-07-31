export default {
  name: 'ping-api',
  cron: '*/14 * * * *',
  async handler() {
    const url = process.env.API_URL || 'http://localhost:3000'
    try {
      const response = await fetch(url)
      if (response.ok) {
        console.log('GET request sent successfully')
      } else {
        console.log('GET request failed', response.status)
      }
    } catch (e) {
      console.error('Error while sending request', e)
    }
  },
}
