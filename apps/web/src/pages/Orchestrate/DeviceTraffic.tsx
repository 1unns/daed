import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { useDeviceTrafficQuery, useClearTrafficStatsMutation } from '~/apis'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
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
  const clearMutation = useClearTrafficStatsMutation()

  return (
    <Card className="flex flex-col w-full max-h-[500px] shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between py-4 pb-2">
        <CardTitle className="text-base font-semibold text-blue-500/80">设备流量</CardTitle>
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
              <TableHead>代理上传</TableHead>
              <TableHead>代理下载</TableHead>
              <TableHead>直连上传</TableHead>
              <TableHead>直连下载</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices?.map((device) => (
              <TableRow key={device.ip}>
                <TableCell className="font-mono text-xs">
                  <div>{device.ip}</div>
                  {device.name && <div className="text-muted-foreground">{device.name}</div>}
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
                <TableCell className="text-xs">
                  <div className="flex items-center text-muted-foreground">
                    <ArrowUp className="mr-1 h-3 w-3" />
                    {formatBytes(Number(device.directUploadTotal))}
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  <div className="flex items-center text-muted-foreground">
                    <ArrowDown className="mr-1 h-3 w-3" />
                    {formatBytes(Number(device.directDownloadTotal))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!devices?.length && (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
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
