import { Activity, ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useClearTrafficStatsMutation, useConnectionTrafficQuery } from '~/apis'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'

function formatBytes(value: number) {
  if (value < 1024) return `${value.toFixed(0)} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}

export function ConnectionTraffic() {
  const { t } = useTranslation()
  const { data: connections } = useConnectionTrafficQuery()
  const clearMutation = useClearTrafficStatsMutation()
  const [ipInfo, setIpInfo] = useState<Record<string, { org?: string; loading?: boolean; error?: boolean }>>({})

  const handleIpClick = async (ip: string) => {
    if (ipInfo[ip]) return;
    setIpInfo(prev => ({ ...prev, [ip]: { loading: true } }))
    try {
      const res = await fetch(`https://get.geojs.io/v1/ip/geo/${ip}.json`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setIpInfo(prev => ({ 
        ...prev, 
        [ip]: { 
          org: data.organization_name || data.organization || data.country || 'Unknown', 
          loading: false 
        } 
      }))
    } catch {
      setIpInfo(prev => ({ ...prev, [ip]: { error: true, loading: false } }))
    }
  }

  const aggregatedConnections = useMemo(() => {
    if (!connections) return []
    const map = new Map<string, { 
      ip: string; 
      uploadTotal: number; 
      downloadTotal: number;
      proxyUploadTotal: number;
      proxyDownloadTotal: number;
      directUploadTotal: number;
      directDownloadTotal: number;
    }>()
    for (const conn of connections) {
      const existing = map.get(conn.ip)
      if (existing) {
        existing.uploadTotal += Number(conn.uploadTotal)
        existing.downloadTotal += Number(conn.downloadTotal)
        existing.proxyUploadTotal += Number(conn.proxyUploadTotal || 0)
        existing.proxyDownloadTotal += Number(conn.proxyDownloadTotal || 0)
        existing.directUploadTotal += Number(conn.directUploadTotal || 0)
        existing.directDownloadTotal += Number(conn.directDownloadTotal || 0)
      } else {
        map.set(conn.ip, {
          ip: conn.ip,
          uploadTotal: Number(conn.uploadTotal),
          downloadTotal: Number(conn.downloadTotal),
          proxyUploadTotal: Number(conn.proxyUploadTotal || 0),
          proxyDownloadTotal: Number(conn.proxyDownloadTotal || 0),
          directUploadTotal: Number(conn.directUploadTotal || 0),
          directDownloadTotal: Number(conn.directDownloadTotal || 0),
        })
      }
    }
    // Sort by total traffic descending so busiest targets appear first
    return Array.from(map.values()).sort(
      (a, b) => (b.uploadTotal + b.downloadTotal) - (a.uploadTotal + a.downloadTotal)
    )
  }, [connections])

  return (
    <Card className="flex flex-col w-full max-h-[500px] shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between py-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-lg text-primary">
          <Activity className="w-5 h-5" />
          {t('orchestrateTraffic.connectionRecords')}
        </CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t('orchestrateTraffic.targetIPs', { count: aggregatedConnections.length })}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-red-500"
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
            title={t('orchestrateTraffic.clearTrafficData')}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto overflow-x-hidden p-0">
        <Table className="table-fixed w-full">
          <TableHeader className="sticky top-0 bg-background/95 backdrop-blur z-10 shadow-sm">
            <TableRow>
              <TableHead className="w-[50%]">IP</TableHead>
              <TableHead className="w-[25%] p-0 pr-6">
                <div className="flex items-center justify-end w-full h-full">
                  <div className="w-[80px] text-center">{t('orchestrateTraffic.upload')}</div>
                </div>
              </TableHead>
              <TableHead className="w-[25%] p-0 pr-6">
                <div className="flex items-center justify-end w-full h-full">
                  <div className="w-[80px] text-center">{t('orchestrateTraffic.download')}</div>
                </div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {aggregatedConnections.map((conn) => (
              <TableRow key={conn.ip}>
                <TableCell className="font-mono text-xs">
                  <div 
                    className="cursor-pointer hover:text-primary transition-colors flex flex-col gap-0.5"
                    onClick={() => handleIpClick(conn.ip)}
                    title={t('orchestrateTraffic.queryIPInfo')}
                  >
                    <span>{conn.ip}</span>
                    {ipInfo[conn.ip]?.loading && <span className="text-muted-foreground text-[10px]">{t('orchestrateTraffic.querying')}</span>}
                    {ipInfo[conn.ip]?.error && <span className="text-red-400 text-[10px]">{t('orchestrateTraffic.queryFailed')}</span>}
                    {ipInfo[conn.ip]?.org && <span className="text-muted-foreground text-[10px] leading-tight">({ipInfo[conn.ip].org})</span>}
                  </div>
                </TableCell>
                <TableCell className="w-[25%] p-0 pr-6 align-middle">
                  <div className="flex items-center justify-end w-full h-full py-2">
                    <div className="flex flex-col items-end w-[90px] gap-0.5">
                      <div className="flex items-center justify-end gap-1 text-orange-500 font-mono text-xs tabular-nums" title={`${t('orchestrateTraffic.proxy')}: ${formatBytes(conn.proxyUploadTotal)}`}>
                        <ArrowUp className="h-3 w-3 shrink-0" />
                        <span>{formatBytes(conn.proxyUploadTotal)}</span>
                        <span className="text-[10px] text-muted-foreground/80">{t('orchestrateTraffic.proxy')}</span>
                      </div>
                      <div className="flex items-center justify-end gap-1 text-muted-foreground font-mono text-[10px] tabular-nums" title={`${t('orchestrateTraffic.direct')}: ${formatBytes(conn.directUploadTotal)}`}>
                        <span>{formatBytes(conn.directUploadTotal)}</span>
                        <span className="text-[10px] text-muted-foreground/60">{t('orchestrateTraffic.direct')}</span>
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="w-[25%] p-0 pr-6 align-middle">
                  <div className="flex items-center justify-end w-full h-full py-2">
                    <div className="flex flex-col items-end w-[90px] gap-0.5">
                      <div className="flex items-center justify-end gap-1 text-cyan-500 font-mono text-xs tabular-nums" title={`${t('orchestrateTraffic.proxy')}: ${formatBytes(conn.proxyDownloadTotal)}`}>
                        <ArrowDown className="h-3 w-3 shrink-0" />
                        <span>{formatBytes(conn.proxyDownloadTotal)}</span>
                        <span className="text-[10px] text-muted-foreground/80">{t('orchestrateTraffic.proxy')}</span>
                      </div>
                      <div className="flex items-center justify-end gap-1 text-muted-foreground font-mono text-[10px] tabular-nums" title={`${t('orchestrateTraffic.direct')}: ${formatBytes(conn.directDownloadTotal)}`}>
                        <span>{formatBytes(conn.directDownloadTotal)}</span>
                        <span className="text-[10px] text-muted-foreground/60">{t('orchestrateTraffic.direct')}</span>
                      </div>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!aggregatedConnections?.length && (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                  {t('orchestrateTraffic.noConnectionRecord')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
