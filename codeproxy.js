const http = require('http')
const httpProxy = require('http-proxy')
const handler = require('serve-handler')

const target = 'http://a4h.dummy.nodomain:50000'
const proxy = httpProxy.createProxyServer({ secure: true, changeOrigin: true })
const saproxy = httpProxy.createProxyServer({ secure: !!target.match(/^https/i), changeOrigin: true })

const handleCors = (_, req, res) => {
    if (req.headers['access-control-request-method']) {
        res.setHeader('access-control-allow-methods', req.headers['access-control-request-method'])
        res.setHeader('access-control-allow-headers', req.headers['access-control-request-headers'])
    }

    if (req.headers['access-control-request-headers']) {
        res.setHeader('access-control-allow-headers', req.headers['access-control-request-headers'])
    }

    if (req.headers.origin)
        res.setHeader('access-control-allow-origin', req.headers.origin)
    res.setHeader('access-control-allow-credentials', 'true')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Access-Control-Expose-Headers', '*')
}

saproxy.on("proxyRes", handleCors)
saproxy.on("error", (err, req, res, target) => {
    console.log(err)
})

const corssaproxy = (req, res) => {
    if (req.method === "OPTIONS") {
        handleCors(undefined, req, res)
        res.statusCode = 200
        res.statusMessage = "OK"
        res.end()
    }
    else saproxy.web(req, res, { target })
}

http.createServer(function (req, res) {
    if (req.url.match(/^\/sap\//)) corssaproxy(req, res)
    else if (req.url.match(/^\/extension\//)) {
        // req.url = req.url.replace(/^\/extension/, "")
        res.setHeader('Access-Control-Allow-Origin', '*')
        handler(req, res, {
            rewrites: [
                { source: '/extension/:p1', destination: ':p1' },
                { source: '/extension/:p1/:p2', destination: ':p1/:p2' },
                { source: '/extension/:p1/:p2/:p3', destination: ':p1/:p2/:p3' },
                { source: '/extension/:p1/:p2/:p3/:p4', destination: ':p1/:p2/:p3/:p4' }
            ]
        })
        // handler(req, res)
    }
    else
        proxy.web(req, res, { target: 'https://vscode.dev' })
}).listen(3000)

