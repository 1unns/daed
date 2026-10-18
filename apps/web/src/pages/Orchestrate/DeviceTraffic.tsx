import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, MonitorSmartphone, Trash2 } from 'lucide-react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useClearTrafficStatsMutation, useConnectionTrafficQuery, useDeviceTrafficQuery } from '~/apis'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'

function formatBytes(value: number) {
  if (value < 1024) return `${value.toFixed(0)} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}

export function DeviceTraffic() {
  const { t } = useTranslation()
  const { data: devices } = useDeviceTrafficQuery()
  const { data: connections } = useConnectionTrafficQuery()
  const clearMutation = useClearTrafficStatsMutation()
  const [expandedIps, setExpandedIps] = useState<Set<string>>(new Set())
  const [ipInfo, setIpInfo] = useState<Record<string, { org?: string; loading?: boolean; error?: boolean }>>({})

  const handleIpClick = async (e: React.MouseEvent, ip: string) => {
    e.stopPropagation()
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

  const toggleExpand = (ip: string) => {
    setExpandedIps((prev) => {
      const next = new Set(prev)
      if (next.has(ip)) next.delete(ip)
      else next.add(ip)
      return next
    })
  }

  return (
    <Card className="flex flex-col w-full max-h-[500px] shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between py-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-lg text-primary">
          <MonitorSmartphone className="w-5 h-5" />
          {t('orchestrateTraffic.deviceTraffic')}
        </CardTitle>
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
            {devices?.map((device) => {
              const isExpanded = expandedIps.has(device.ip)
              // Only find connections where the srcIp (first part of id before '-') matches the device IP
              const activeConnections = connections?.filter(c => c.id.split('-')[0].replace(/:\d+$/, '') === device.ip) || []

              return (
                <React.Fragment key={device.ip}>
                  <TableRow 
                    className="cursor-pointer hover:bg-muted/50 transition-colors group"
                    onClick={() => toggleExpand(device.ip)}
                    title={t('orchestrateTraffic.viewActiveConnections')}
                  >
                    <TableCell className="font-mono text-xs">
                      <div className="flex items-center gap-1.5">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                        )}
                        <div className="flex flex-col">
                          <span>{device.ip}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="w-[25%] p-0 pr-6 align-middle">
                      <div className="flex items-center justify-end w-full h-full py-2">
                        <div className="flex flex-col items-end w-[90px] gap-0.5">
                          <div className="flex items-center justify-end gap-1 text-orange-500 font-mono text-xs tabular-nums" title={`${t('orchestrateTraffic.proxy')}: ${formatBytes(Number(device.proxyUploadTotal))}`}>
                            <ArrowUp className="h-3 w-3 shrink-0" />
                            <span>{formatBytes(Number(device.proxyUploadTotal))}</span>
                            <span className="text-[10px] text-muted-foreground/80">{t('orchestrateTraffic.proxy')}</span>
                          </div>
                          <div className="flex items-center justify-end gap-1 text-muted-foreground font-mono text-[10px] tabular-nums" title={`${t('orchestrateTraffic.direct')}: ${formatBytes(Number(device.directUploadTotal))}`}>
                            <span>{formatBytes(Number(device.directUploadTotal))}</span>
                            <span className="text-[10px] text-muted-foreground/60">{t('orchestrateTraffic.direct')}</span>
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="w-[25%] p-0 pr-6 align-middle">
                      <div className="flex items-center justify-end w-full h-full py-2">
                        <div className="flex flex-col items-end w-[90px] gap-0.5">
                          <div className="flex items-center justify-end gap-1 text-cyan-500 font-mono text-xs tabular-nums" title={`${t('orchestrateTraffic.proxy')}: ${formatBytes(Number(device.proxyDownloadTotal))}`}>
                            <ArrowDown className="h-3 w-3 shrink-0" />
                            <span>{formatBytes(Number(device.proxyDownloadTotal))}</span>
                            <span className="text-[10px] text-muted-foreground/80">{t('orchestrateTraffic.proxy')}</span>
                          </div>
                          <div className="flex items-center justify-end gap-1 text-muted-foreground font-mono text-[10px] tabular-nums" title={`${t('orchestrateTraffic.direct')}: ${formatBytes(Number(device.directDownloadTotal))}`}>
                            <span>{formatBytes(Number(device.directDownloadTotal))}</span>
                            <span className="text-[10px] text-muted-foreground/60">{t('orchestrateTraffic.direct')}</span>
                          </div>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow className="bg-muted/20 hover:bg-muted/20">
                      <TableCell colSpan={3} className="p-0 border-b-0">
                        <div className="py-3 text-xs">
                          {activeConnections.length > 0 ? (
                            <div className="space-y-1">
                              <div className="text-muted-foreground font-medium mb-2 border-b border-border/50 pb-1 pl-[38px] pr-4">
                                {t('orchestrateTraffic.activeConnections', { count: activeConnections.length })}
                              </div>
                              <div>
                                <Table className="table-fixed w-full">
                                  <TableBody>
                                    {activeConnections
                                      // Sort active connections by traffic size descending
                                      .sort((a, b) => (Number(b.uploadTotal) + Number(b.downloadTotal)) - (Number(a.uploadTotal) + Number(a.downloadTotal)))
                                      .map(conn => {
                                        const dstPort = conn.dstPort || conn.id.split('-')[1]?.split(':')[1] || ''
                                        return (
                                          <TableRow key={conn.id} className="border-b border-border/30 last:border-0 hover:bg-muted/40 transition-colors">
                                            <TableCell className="w-[50%] p-0 py-1.5 align-middle pl-[38px] pr-4">
                                              <div 
                                                className="font-mono text-muted-foreground flex items-center cursor-pointer hover:text-primary transition-colors min-w-0" 
                                                title={`${t('orchestrateTraffic.queryIPInfo')}\n${conn.ip}:${dstPort}`}
                                                onClick={(e) => handleIpClick(e, conn.ip)}
                                              >
                                                <span className="text-foreground/80 shrink-0">{conn.ip}</span>
                                                <span className="text-foreground/50 shrink-0">:{dstPort}</span>
                                                {ipInfo[conn.ip]?.loading && <span className="text-muted-foreground text-[10px] whitespace-nowrap ml-1 shrink-0">{t('orchestrateTraffic.querying')}</span>}
                                                {ipInfo[conn.ip]?.error && <span className="text-red-400 text-[10px] whitespace-nowrap ml-1 shrink-0">{t('orchestrateTraffic.queryFailed')}</span>}
                                                {ipInfo[conn.ip]?.org && <span className="text-muted-foreground text-[10px] truncate ml-1" title={ipInfo[conn.ip].org}>({ipInfo[conn.ip].org})</span>}
                                              </div>
                                            </TableCell>
                                            <TableCell className="w-[25%] p-0 pr-6 py-1.5 align-middle">
                                              <div className="flex items-center justify-end w-full h-full">
                                                <div className="flex items-center justify-center w-[80px] gap-1 text-orange-500 font-mono text-xs tabular-nums">
                                                  <ArrowUp className="h-[10px] w-[10px] shrink-0" />
                                                  <span>{formatBytes(Number(conn.uploadTotal))}</span>
                                                </div>
                                              </div>
                                            </TableCell>
                                            <TableCell className="w-[25%] p-0 pr-6 py-1.5 align-middle">
                                              <div className="flex items-center justify-end w-full h-full">
                                                <div className="flex items-center justify-center w-[80px] gap-1 text-cyan-500 font-mono text-xs tabular-nums">
                                                  <ArrowDown className="h-[10px] w-[10px] shrink-0" />
                                                  <span>{formatBytes(Number(conn.downloadTotal))}</span>
                                                </div>
                                              </div>
                                            </TableCell>
                                          </TableRow>
                                        )
                                      })}
                                  </TableBody>
                                </Table>
                              </div>
                            </div>
                          ) : (
                            <div className="text-center text-muted-foreground py-2 flex items-center justify-center gap-2">
                              <MonitorSmartphone className="h-4 w-4 opacity-50" />
                              {t('orchestrateTraffic.noActiveConnections')}
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              )
            })}
            {!devices?.length && (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                  {t('orchestrateTraffic.noDeviceTraffic')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
