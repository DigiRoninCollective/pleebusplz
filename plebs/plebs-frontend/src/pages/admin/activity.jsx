import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'

function toCSV(rows) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const escape = v => '"' + String(v).replace(/"/g, '""') + '"'
  const csv = [headers.join(',')]
  for (const row of rows) {
    csv.push(headers.map(h => escape(
      typeof row[h] === 'object' && row[h] !== null ? JSON.stringify(row[h]) : row[h]
    )).join(','))
  }
  return csv.join('\n')
}

export default function AdminActivityLog() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const router = useRouter()
  const limit = 20

  useEffect(() => {
    setLoading(true)
    let url = `/api/admin/activity-log?limit=${limit}&offset=${(page - 1) * limit}`
    if (action) url += `&action=${encodeURIComponent(action)}`
    fetch(url, {
      credentials: 'include'
    })
      .then(async res => {
        if (res.status === 401 || res.status === 403) {
          router.push('/admin/login')
          return
        }
        const data = await res.json()
        setLogs(data.logs || [])
        setHasMore((data.logs || []).length === limit)
        setLoading(false)
      })
      .catch(err => {
        setError('Failed to load activity logs')
        setLoading(false)
      })
  }, [router, page, action])

  const handlePrev = () => setPage(p => Math.max(1, p - 1))
  const handleNext = () => setPage(p => p + 1)
  const handleActionChange = e => {
    setAction(e.target.value)
    setPage(1)
  }
  const handleExportCSV = () => {
    const csv = toCSV(logs)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `activity_logs_page${page}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (loading) return <div>Loading...</div>
  if (error) return <div>{error}</div>

  return (
    <div>
      <h1>Wallet Activity Log</h1>
      <div style={{ marginBottom: 16 }}>
        <label>
          Filter by action:
          <input
            type="text"
            value={action}
            onChange={handleActionChange}
            placeholder="e.g. mint_tokens"
            style={{ marginLeft: 8 }}
          />
        </label>
        <button style={{ marginLeft: 16 }} onClick={handleExportCSV} disabled={!logs.length}>
          Export CSV
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Telegram ID</th>
            <th>Action</th>
            <th>Details</th>
            <th>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {logs.map(log => (
            <tr key={log.id}>
              <td>{log.id}</td>
              <td>{log.telegram_id}</td>
              <td>{log.action}</td>
              <td><pre>{JSON.stringify(log.details, null, 2)}</pre></td>
              <td>{log.timestamp}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 16 }}>
        <button onClick={handlePrev} disabled={page === 1}>Previous</button>
        <span style={{ margin: '0 8px' }}>Page {page}</span>
        <button onClick={handleNext} disabled={!hasMore}>Next</button>
      </div>
    </div>
  )
}

// Server-side code (e.g., in your API route handler)
// res.cookie('adminToken', token, {
//   httpOnly: true,
//   secure: process.env.NODE_ENV === 'production',
//   sameSite: 'strict',
//   maxAge: 12 * 60 * 60 * 1000 // 12 hours
// });