import { Card, CardBody } from "@/components/ui";

/** Skeleton matching the dashboard's shape, so the layout does not jump. */
export default function AdminLoading() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="mb-7 space-y-2">
        <div className="h-2.5 w-20 animate-pulse rounded-xs bg-surface-sunken" />
        <div className="h-7 w-56 animate-pulse rounded-sm bg-surface-sunken" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i}>
            <CardBody>
              <div className="h-2.5 w-24 animate-pulse rounded-xs bg-surface-sunken" />
              <div className="mt-3 h-8 w-14 animate-pulse rounded-sm bg-surface-sunken" />
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
