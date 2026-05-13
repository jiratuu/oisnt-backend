import express from 'express'
import axios from 'axios'
import { HttpsProxyAgent } from 'hpagent'

const app = express()
app.use(express.json())

const PORT = process.env.PORT || 3000

// === PAGE D'ACCUEIL ===
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>OSINT Engine</title>
      <style>
        body { background: #0d1117; color: #c9d1d9; font-family: monospace; padding: 40px; max-width: 800px; margin: auto; }
        h1 { color: #58a6ff; }
        input, select, button { padding: 10px; margin: 5px; border-radius: 6px; border: 1px solid #30363d; font-size: 14px; }
        input { background: #161b22; color: #c9d1d9; width: 300px; }
        select, button { background: #21262d; color: #c9d1d9; cursor: pointer; }
        button:hover { background: #30363d; }
        pre { background: #161b22; padding: 20px; border-radius: 8px; margin-top: 20px; overflow: auto; max-height: 500px; border: 1px solid #30363d; }
        .status { color: #3fb950; }
        .label { color: #8b949e; font-size: 12px; }
      </style>
    </head>
    <body>
      <h1>🔍 OSINT Engine</h1>
      <p>Recherche via proxy dynamique — ton IP est protégée</p>
      
      <div>
        <input type="text" id="query" placeholder="Email (ex: bill@microsoft.com)">
        
        <select id="type">
          <option value="email">Email</option>
          <option value="test">Tester un proxy</option>
        </select>
        
        <select id="gender">
          <option value="">Filtre sexe (aucun)</option>
          <option value="male">Homme seulement</option>
          <option value="female">Femme seulement</option>
        </select>
        
        <button onclick="search()">🔍 Lancer</button>
        <button onclick="testProxy()">🔄 Tester proxy</button>
      </div>
      
      <pre id="result">Prêt. Lance une recherche...</pre>

      <p class="label">
        <span class="status">●</span> 
        Proxys disponibles : <span id="proxyCount">?</span>
      </p>

      <script>
        async function search() {
          const query = document.getElementById('query').value
          const type = document.getElementById('type').value
          const genderFilter = document.getElementById('gender').value
          
          if (!query && type === 'email') {
            document.getElementById('result').textContent = 'Entre un email valide'
            return
          }
          
          document.getElementById('result').textContent = '⏳ Recherche en cours...'
          
          try {
            const response = await fetch('/api/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query, type, genderFilter })
            })
            const data = await response.json()
            document.getElementById('result').textContent = JSON.stringify(data, null, 2)
          } catch(e) {
            document.getElementById('result').textContent = 'Erreur : ' + e.message
          }
        }
        
        async function testProxy() {
          document.getElementById('result').textContent = '⏳ Test du proxy...'
          try {
            const response = await fetch('/api/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query: '', type: 'test' })
            })
            const data = await response.json()
            document.getElementById('result').textContent = JSON.stringify(data, null, 2)
          } catch(e) {
            document.getElementById('result').textContent = 'Erreur : ' + e.message
          }
        }
        
        // Charger le nombre de proxys
        fetch('/api/status').then(r => r.json()).then(d => {
          document.getElementById('proxyCount').textContent = d.proxies_disponibles
        })
      </script>
    </body>
    </html>
  `)
})

// === GESTION DES PROXYS ===
const proxyPool = []
let currentIndex = 0
const failCounts = {}

async function refreshProxies() {
  console.log('[Proxy] Rafraîchissement...')
  try {
    // Source de proxies gratuits
    const response = await axios.get(
      'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
      { timeout: 10000 }
    )
    
    const lines = response.data.split('\n')
    proxyPool.length = 0
    
    for (const line of lines) {
      const match = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d+)/)
      if (match) {
        proxyPool.push({ ip: match[1], port: parseInt(match[2]) })
      }
    }
    
    currentIndex = 0
    console.log(`[Proxy] Pool : ${proxyPool.length} proxies chargés`)
  } catch (err) {
    console.error('[Proxy] Erreur:', err.message)
  }
}

function getNextProxy() {
  if (proxyPool.length === 0) return null
  const proxy = proxyPool[currentIndex % proxyPool.length]
  currentIndex = (currentIndex + 1) % proxyPool.length
  return proxy
}

function reportFailure(proxy) {
  const key = `${proxy.ip}:${proxy.port}`
  failCounts[key] = (failCounts[key] || 0) + 1
  if (failCounts[key] >= 3) {
    const idx = proxyPool.findIndex(p => p.ip === proxy.ip && p.port === proxy.port)
    if (idx !== -1) proxyPool.splice(idx, 1)
    console.log(`[Proxy] Retiré : ${key}`)
  }
}

function reportSuccess(proxy) {
  const key = `${proxy.ip}:${proxy.port}`
  failCounts[key] = 0
}

function guessGender(name) {
  if (!name) return 'unknown'
  const clean = name.toLowerCase().replace(/[0-9._-]/g, '').trim().split(' ')[0]
  
  const maleNames = ['john', 'james', 'robert', 'michael', 'william', 'david',
    'pierre', 'jean', 'michel', 'nicolas', 'alexandre', 'julien', 'romain',
    'florian', 'kevin', 'thomas', 'antoine', 'francois', 'paul', 'noham']
  
  const femaleNames = ['mary', 'jennifer', 'linda', 'elizabeth', 'jessica',
    'marie', 'nathalie', 'isabelle', 'sophie', 'julie', 'catherine',
    'sandra', 'anne', 'emma', 'camille', 'lea', 'manon', 'chloe']
  
  if (maleNames.includes(clean)) return 'male'
  if (femaleNames.includes(clean)) return 'female'
  return 'unknown'
}

// Route principale de recherche
app.post('/api/search', async (req, res) => {
  const { query, type, genderFilter } = req.body
  
  if (!query || !type) {
    return res.status(400).json({ error: 'query et type requis' })
  }

  // 1. Prendre un proxy
  const proxy = getNextProxy()
  if (!proxy) {
    return res.status(503).json({ error: 'Aucun proxy disponible, réessaie dans 30s' })
  }

  console.log(`[Requête] ${query} via proxy ${proxy.ip}:${proxy.port}`)

  // 2. Construire l'appel à l'API OSINT via le proxy
  try {
    let apiUrl = ''
    let headers = { 'Accept': 'application/json' }

    if (type === 'email') {
      apiUrl = `https://emailrep.io/${encodeURIComponent(query)}`
      headers['User-Agent'] = 'Mozilla/5.0'
    } else if (type === 'test') {
      // Pour tester que le proxy fonctionne
      apiUrl = 'https://httpbin.org/ip'
    } else {
      return res.status(400).json({ error: 'Type invalide (email ou test)' })
    }

    // Créer l'agent avec le proxy
    const agent = new HttpsProxyAgent({
      proxy: `http://${proxy.ip}:${proxy.port}`,
      timeout: 10000,
    })

    // Faire la requête via le proxy
    const response = await axios.get(apiUrl, {
      headers,
      httpsAgent: agent,
      timeout: 15000,
    })

    reportSuccess(proxy)

    // Traiter les résultats
    let result = response.data
    
    // Si c'est une recherche email, on peut filtrer par sexe
    let genderDetected = null
    let filterApplied = false
    
    if (type === 'email' && result.email) {
      const namePart = query.split('@')[0]
      genderDetected = guessGender(namePart)
      
      if (genderFilter && genderDetected !== genderFilter) {
        filterApplied = true
        result = { ...result, filtered_by_gender: true, gender_detected: genderDetected }
      }
    }

    res.json({
      success: true,
      proxy_used: `${proxy.ip}:${proxy.port}`,
      gender_detected: genderDetected,
      filter_applied: filterApplied ? genderFilter : null,
      result
    })

  } catch (error) {
    reportFailure(proxy)
    console.error(`[Erreur] Proxy ${proxy.ip}:${proxy.port} : ${error.message}`)
    
    // Réessayer avec un autre proxy
    try {
      const proxy2 = getNextProxy()
      if (proxy2) {
        console.log(`[Retry] Tentative avec ${proxy2.ip}:${proxy2.port}`)
        
        const agent2 = new HttpsProxyAgent({
          proxy: `http://${proxy2.ip}:${proxy2.port}`,
          timeout: 10000,
        })
        
        let apiUrl = type === 'email' 
          ? `https://emailrep.io/${encodeURIComponent(query)}`
          : 'https://httpbin.org/ip'
        
        const retryResponse = await axios.get(apiUrl, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
          httpsAgent: agent2,
          timeout: 15000,
        })
        
        reportSuccess(proxy2)
        
        return res.json({
          success: true,
          proxy_used: `${proxy2.ip}:${proxy2.port}`,
          retry: true,
          result: retryResponse.data
        })
      }
    } catch {}
    
    res.status(502).json({ success: false, error: 'Tous les proxies ont échoué' })
  }
})

// Route pour voir le statut
app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    proxies_disponibles: proxyPool.length,
  })
})

// Démarrer le serveur
app.listen(PORT, async () => {
  console.log(`Serveur démarré sur le port ${PORT}`)
  await refreshProxies()
  // Rafraîchir les proxies toutes les 10 minutes
  setInterval(refreshProxies, 600000)
})
