import { useTranslation } from 'react-i18next'
import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { useConnectionTrafficQuery } from '~/apis'
import { ArrowDown, ArrowUp, Activity } from 'lucide-react'

function formatBytes(value: number) {
  if (value < 1024) return `${value.toFixed(0)} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}

export function ConnectionTraffic() {
  const { t } = useTranslation()
  const { data: connections } = useConnectionTrafficQuery()

  const aggregatedConnections = useMemo(() => {
    if (!connections) return []
    const map = new Map<string, { ip: string; uploadTotal: number; downloadTotal: number }>()
    for (const conn of connections) {
      const existing = map.get(conn.ip)
      if (existing) {
        existing.uploadTotal += Number(conn.uploadTotal)
        existing.downloadTotal += Number(conn.downloadTotal)
      } else {
        map.set(conn.ip, {
          ip: conn.ip,
          uploadTotal: Number(conn.uploadTotal),
          downloadTotal: Number(conn.downloadTotal),
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
          流量记录
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          {aggregatedConnections.length} 个目标 IP（累计，点清除重置）
        </span>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto overflow-x-hidden p-0">
        <Table>
          <TableHeader className="sticky top-0 bg-background/95 backdrop-blur z-10 shadow-sm">
            <TableRow>
              <TableHead className="w-[200px]">IP</TableHead>
              <TableHead>上传</TableHead>
              <TableHead>下载</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {aggregatedConnections.map((conn) => (
              <TableRow key={conn.ip}>
                <TableCell className="font-mono text-xs">
                  <div>{conn.ip}</div>
                </TableCell>
                <TableCell className="text-xs">
                  <div className="flex items-center text-orange-500">
                    <ArrowUp className="mr-1 h-3 w-3" />
                    {formatBytes(Number(conn.uploadTotal))}
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  <div className="flex items-center text-cyan-500">
                    <ArrowDown className="mr-1 h-3 w-3" />
                    {formatBytes(Number(conn.downloadTotal))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!aggregatedConnections?.length && (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                  暂无连接数据
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
