import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { useConnectionTrafficQuery } from '~/apis'
import { ArrowDown, ArrowUp } from 'lucide-react'

function formatBytes(value: number) {
  if (value < 1024) return `${value.toFixed(0)} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}

export function ConnectionTraffic() {
  const { t } = useTranslation()
  const { data: connections } = useConnectionTrafficQuery()

  return (
    <Card className="flex flex-col flex-1 h-full max-h-[500px]">
      <CardHeader className="flex flex-row items-center justify-between py-4 pb-2">
        <CardTitle className="text-base font-semibold text-blue-500/80">活动连接</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto p-0">
        <Table>
          <TableHeader className="sticky top-0 bg-background/95 backdrop-blur z-10">
            <TableRow>
              <TableHead className="w-[200px]">域名 / IP</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>上传</TableHead>
              <TableHead>下载</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {connections?.map((conn) => (
              <TableRow key={conn.id}>
                <TableCell className="font-mono text-xs">
                  <div>{conn.domain}</div>
                  <div className="text-muted-foreground">{conn.ip}</div>
                </TableCell>
                <TableCell className="text-xs">
                  <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80">
                    {conn.state}
                  </span>
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
            {!connections?.length && (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
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
