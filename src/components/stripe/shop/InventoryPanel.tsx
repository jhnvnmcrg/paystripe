import { useState } from 'react'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Spinner } from '#/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table'
import type { InventoryRow } from '#/lib/lab/shop/shop.server'
import { resetShopStock } from '#/lib/lab/shop/shop.functions'

interface InventoryPanelProps {
  inventory: InventoryRow[]
  onReset: (inventory: InventoryRow[]) => void
}

/** The stockroom view: what's on the shelf, what open checkouts hold, and what's left to sell. */
export default function InventoryPanel({ inventory, onReset }: InventoryPanelProps) {
  const [resetting, setResetting] = useState(false)

  async function reset() {
    setResetting(true)
    try {
      onReset(await resetShopStock())
    } finally {
      setResetting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Stock</CardTitle>
        <CardDescription>
          Held units belong to open checkouts. They return to sale if the checkout expires.
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={reset} disabled={resetting}>
            {resetting ? <Spinner data-icon="inline-start" /> : null}
            Reset stock
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">On the shelf</TableHead>
              <TableHead className="text-right">Held</TableHead>
              <TableHead className="text-right">For sale</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {inventory.map((row) => (
              <TableRow key={row.sku}>
                <TableCell className="font-medium">{row.label}</TableCell>
                <TableCell className="amount text-right">{row.onHand}</TableCell>
                <TableCell className="amount text-right">{row.reserved}</TableCell>
                <TableCell className="amount text-right">{row.available}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
