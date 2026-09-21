import { useMemo, useState } from "react";
import {
  getGetActivityReportQueryKey,
  getListAppsQueryKey,
  getListUsersQueryKey,
  useGetActivityReport,
  useListApps,
  useListUsers,
} from "@workspace/api-client-react";
import {
  Activity,
  AppWindow,
  CheckCircle2,
  ChevronDown,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

function utcDateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
}: {
  title: string;
  value: number;
  subtitle: string;
  icon: typeof Activity;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="mt-1 text-3xl font-bold tracking-tight">{value.toLocaleString()}</p>
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ActivityReport() {
  const [from, setFrom] = useState(() => utcDateOffset(-29));
  const [to, setTo] = useState(() => utcDateOffset(0));
  const [app, setApp] = useState("all");
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);

  const params = useMemo(
    () => ({
      from,
      to,
      app: app === "all" ? undefined : app,
      person: selectedPeople.length ? selectedPeople : undefined,
    }),
    [from, to, app, selectedPeople],
  );
  const { data: report, isLoading, isError } = useGetActivityReport(params, {
    query: {
      queryKey: getGetActivityReportQueryKey(params),
      refetchInterval: 60_000,
    },
  });
  const { data: apps } = useListApps({
    query: { queryKey: getListAppsQueryKey() },
  });
  const { data: users } = useListUsers({
    query: { queryKey: getListUsersQueryKey() },
  });
  const people = useMemo(
    () => [...new Set(users?.map((user) => user.name) ?? [])].sort((a, b) => a.localeCompare(b)),
    [users],
  );
  const togglePerson = (name: string) => {
    setSelectedPeople((current) =>
      current.includes(name) ? current.filter((person) => person !== name) : [...current, name],
    );
  };

  const summary = report?.summary;
  const appChartData = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of report?.byPersonApp ?? []) {
      totals.set(row.app, (totals.get(row.app) ?? 0) + row.allowedAccess);
    }
    return [...totals.entries()]
      .map(([app, allowedAccess]) => ({ app, allowedAccess }))
      .sort((a, b) => b.allowedAccess - a.allowedAccess || a.app.localeCompare(b.app));
  }, [report?.byPersonApp]);

  return (
    <div className="p-8 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-7">
        <h1 className="text-3xl font-bold tracking-tight">Activity Report</h1>
        <p className="mt-1 text-muted-foreground">
          Successful application access checks by person and application.
        </p>
      </div>

      <Card className="mb-6">
        <CardContent className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="activity-from">From</Label>
            <Input id="activity-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="activity-to">To</Label>
            <Input id="activity-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Application</Label>
            <Select value={app} onValueChange={setApp}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All applications</SelectItem>
                {apps?.map((item) => (
                  <SelectItem key={item.id} value={item.name}>{item.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Person</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between font-normal">
                  <span className="truncate">
                    {selectedPeople.length === 0
                      ? "All people"
                      : selectedPeople.length === 1
                        ? selectedPeople[0]
                        : `${selectedPeople.length} people selected`}
                  </span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-2">
                <div className="mb-2 flex items-center justify-between border-b pb-2">
                  <span className="text-xs font-medium text-muted-foreground">Select people</span>
                  {selectedPeople.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => setSelectedPeople([])}
                    >
                      Clear
                    </Button>
                  )}
                </div>
                <div className="max-h-60 space-y-1 overflow-y-auto">
                  {people.length ? people.map((name) => (
                    <label
                      key={name}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      <Checkbox
                        checked={selectedPeople.includes(name)}
                        onCheckedChange={() => togglePerson(name)}
                      />
                      <span className="truncate">{name}</span>
                    </label>
                  )) : (
                    <p className="px-2 py-3 text-sm text-muted-foreground">No managed users found.</p>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </CardContent>
      </Card>

      {isError ? (
        <Card className="border-destructive/40">
          <CardContent className="p-8 text-center text-destructive">
            The activity report could not be loaded. Check the selected dates and try again.
          </CardContent>
        </Card>
      ) : isLoading || !summary ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">Loading activity report...</CardContent>
        </Card>
      ) : (
        <>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Allowed access by application</CardTitle>
            </CardHeader>
            <CardContent>
              {appChartData.length ? (
                <ChartContainer
                  config={{
                    allowedAccess: {
                      label: "Allowed access",
                      color: "hsl(var(--primary))",
                    },
                  }}
                  className="h-[340px] w-full aspect-auto"
                >
                  <BarChart
                    accessibilityLayer
                    data={appChartData}
                    margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="app"
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      angle={appChartData.length > 4 ? -35 : 0}
                      textAnchor={appChartData.length > 4 ? "end" : "middle"}
                      height={appChartData.length > 4 ? 72 : 30}
                    />
                    <YAxis
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      width={48}
                    />
                    <ChartTooltip
                      cursor={false}
                      content={<ChartTooltipContent />}
                    />
                    <Bar
                      dataKey="allowedAccess"
                      fill="var(--color-allowedAccess)"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={64}
                    />
                  </BarChart>
                </ChartContainer>
              ) : (
                <div className="flex h-[340px] items-center justify-center text-sm text-muted-foreground">
                  No allowed access matches these filters.
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard
              title="Allowed access"
              value={summary.allowedAccess}
              subtitle="Successful authorization checks"
              icon={CheckCircle2}
            />
            <MetricCard
              title="People"
              value={summary.activePeople}
              subtitle="People with allowed access"
              icon={Users}
            />
            <MetricCard
              title="Applications"
              value={summary.activeApps}
              subtitle="Applications with allowed access"
              icon={AppWindow}
            />
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Allowed access by person and application</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Person</TableHead>
                      <TableHead>Application</TableHead>
                      <TableHead className="text-right">Allowed access</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.byPersonApp.length ? report.byPersonApp.map((row) => (
                      <TableRow key={`${row.person}-${row.app}`}>
                        <TableCell className="font-medium">{row.person}</TableCell>
                        <TableCell>{row.app}</TableCell>
                        <TableCell className="text-right font-semibold text-green-700 dark:text-green-400">
                          {row.allowedAccess.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    )) : (
                      <TableRow>
                        <TableCell colSpan={3} className="py-12 text-center text-muted-foreground">
                          No allowed access matches these filters.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="mt-6 rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
            <strong className="text-foreground">What this measures:</strong> Each count is a successful authorization check
            recorded for a person and application. It does not represent a confirmed application login, session, or business transaction.
          </div>
        </>
      )}
    </div>
  );
}