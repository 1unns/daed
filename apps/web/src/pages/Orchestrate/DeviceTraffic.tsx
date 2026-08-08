import { useTranslation } from 'react-i18next'
import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { useDeviceTrafficQuery, useClearTrafficStatsMutation, useConnectionTrafficQuery } from '~/apis'
import { ArrowDown, ArrowUp, Trash2, MonitorSmartphone, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '~/components/ui/button'

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
          设备流量
        </CardTitle>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-red-500"
          onClick={() => clearMutation.mutate()}
          disabled={clearMutation.isPending}
          title="清理流量数据"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto overflow-x-hidden p-0">
        <Table>
          <TableHeader className="sticky top-0 bg-background/95 backdrop-blur z-10 shadow-sm">
            <TableRow>
              <TableHead className="w-[150px]">IP</TableHead>
              <TableHead>上传</TableHead>
              <TableHead>下载</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices?.map((device) => {
              const isExpanded = expandedIps.has(device.ip)
              // Only find connections where the srcIp (first part of id before '-') matches the device IP
              const activeConnections = connections?.filter(c => c.id.split('-')[0].split(':')[0] === device.ip) || []

              return (
                <React.Fragment key={device.ip}>
                  <TableRow 
                    className="cursor-pointer hover:bg-muted/50 transition-colors group"
                    onClick={() => toggleExpand(device.ip)}
                    title="点击查看该设备当前活动的网络连接"
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
                          {device.name && <span className="text-muted-foreground text-[10px]">{device.name}</span>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="flex items-center text-orange-500">
                        <ArrowUp className="mr-1 h-3 w-3" />
                        {formatBytes(Number(device.proxyUploadTotal))}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="flex items-center text-cyan-500">
                        <ArrowDown className="mr-1 h-3 w-3" />
                        {formatBytes(Number(device.proxyDownloadTotal))}
                      </div>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow className="bg-muted/20 hover:bg-muted/20">
                      <TableCell colSpan={3} className="p-0 border-b-0">
                        <div className="px-8 py-3 text-xs">
                          {activeConnections.length > 0 ? (
                            <div className="space-y-1">
                              <div className="text-muted-foreground font-medium mb-2 border-b border-border/50 pb-1">
                                正在活动的连接 ({activeConnections.length})
                              </div>
                              <div className="max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                                {activeConnections
                                  // Sort active connections by traffic size descending
                                  .sort((a, b) => (Number(b.uploadTotal) + Number(b.downloadTotal)) - (Number(a.uploadTotal) + Number(a.downloadTotal)))
                                  .map(conn => {
                                    // id format: "srcIp:srcPort-dstIp:dstPort"
                                    const dstPort = conn.id.split('-')[1]?.split(':')[1] || ''
                                    return (
                                      <div key={conn.id} className="grid grid-cols-[1fr_80px_80px] gap-4 py-1.5 border-b border-border/30 last:border-0 hover:bg-muted/40 rounded px-2 transition-colors">
                                        <div className="font-mono truncate text-muted-foreground" title={`${conn.ip}:${dstPort}`}>
                                          <span className="text-foreground/80">{conn.ip}</span>
                                          <span className="text-foreground/50">:{dstPort}</span>
                                        </div>
                                        <div className="text-orange-500/80 flex items-center justify-end font-mono">
                                          <ArrowUp className="mr-1 h-[10px] w-[10px]" />
                                          {formatBytes(Number(conn.uploadTotal))}
                                        </div>
                                        <div className="text-cyan-500/80 flex items-center justify-end font-mono">
                                          <ArrowDown className="mr-1 h-[10px] w-[10px]" />
                                          {formatBytes(Number(conn.downloadTotal))}
                                        </div>
                                      </div>
                                    )
                                })}
                              </div>
                            </div>
                          ) : (
                            <div className="text-center text-muted-foreground py-2 flex items-center justify-center gap-2">
                              <MonitorSmartphone className="h-4 w-4 opacity-50" />
                              此设备目前没有活动的连接
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
                  暂无设备数据
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
