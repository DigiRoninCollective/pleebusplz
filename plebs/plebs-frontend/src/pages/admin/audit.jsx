import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'

export default function AdminAuditLog() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const [username, setUsername] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const router = useRouter()
  const limit = 20

  useEffect(() => {
    setLoading(true)
    let url = `/api/admin/audit-log?limit=${limit}&offset=${(page - 1) * limit}`
    if (action) url += `&action=${encodeURIComponent(action)}`
    if (username) url += `&username=${encodeURIComponent(username)}`
    fetch(url, { credentials: 'include' })
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
        setError('Failed to load audit logs')
        setLoading(false)
      })
  }, [router, page, action, username])

  const handlePrev = () => setPage(p => Math.max(1, p - 1))
  const handleNext = () => setPage(p => p + 1)
  const handleActionChange = e => {
    setAction(e.target.value)
    setPage(1)
  }
  const handleUsernameChange = e => {
    setUsername(e.target.value)
    setPage(1)
  }

  if (loading) return <div>Loading...</div>
  if (error) return <div>{error}</div>

  return (
    <div>
      <h1>Admin Audit Log</h1>
      <div style={{ marginBottom: 16 }}>
        <label>
          Filter by action:
          <input
            type="text"
            value={action}
            onChange={handleActionChange}
            placeholder="e.g. login"
            style={{ marginLeft: 8 }}
          />
        </label>
        <label style={{ marginLeft: 16 }}>
          Filter by username:
          <input
            type="text"
            value={username}
            onChange={handleUsernameChange}
            placeholder="e.g. admin"
            style={{ marginLeft: 8 }}
          />
        </label>
      </div>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Admin Username</th>
            <th>Action</th>
            <th>Details</th>
            <th>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {logs.map(log => (
            <tr key={log.id}>
              <td>{log.id}</td>
              <td>{log.admin_username}</td>
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
