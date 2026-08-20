import { useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

import { RouteEditDialog } from './RouteEditDialog';
import type { Route } from '../../model/types';

function routeLabel(route: Route): string {
  return `${route.from.label} → ${route.to.label}`;
}

function nextRouteId(routes: Route[]): string {
  let n = routes.length + 1;
  while (routes.some((r) => r._id === `route_new_${n}`)) n += 1;
  return `route_new_${n}`;
}

// routes.json is reference data shared across trips, not scoped to any one
// date — a Transit merely points at one via its own routeId/routeVariant.
// This is a separate small list-then-edit dialog rather than a day-list
// drill-down like Activity/Stay/Transit editing, mirroring
// docs/js/app.js's own openRoutesDialog/openNewRouteEditor. onSave/onDelete
// go straight to the caller's own routes collection — there's no per-entity
// id this dialog is already scoped to the way EditContext's pencil-button
// flow is.
export function RoutesDialog({
  routes,
  open,
  onClose,
  onSave,
  onDelete,
}: {
  routes: Route[];
  open: boolean;
  onClose: () => void;
  onSave: (route: Route) => void;
  onDelete: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Route | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return routes
      .filter((r) => !needle || routeLabel(r).toLowerCase().includes(needle))
      .sort((a, b) => routeLabel(a).localeCompare(routeLabel(b)));
  }, [routes, query]);

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle>Routes</DialogTitle>
        <DialogContent dividers>
          <TextField
            label="Search routes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            fullWidth
            size="small"
            sx={{ mb: 2 }}
          />
          {filtered.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No routes yet.
            </Typography>
          ) : (
            <List disablePadding>
              {filtered.map((route) => (
                <ListItemButton key={route._id} onClick={() => setEditing(route)}>
                  <ListItemText primary={routeLabel(route)} />
                </ListItemButton>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', px: 3 }}>
          <Button
            onClick={() => setEditing({ _id: nextRouteId(routes), from: { id: null, label: '' }, to: { id: null, label: '' }, variants: [], images: [] })}
          >
            Add route
          </Button>
          <Button onClick={onClose}>Close</Button>
        </DialogActions>
      </Dialog>
      {editing && (
        <RouteEditDialog
          route={editing}
          isNew={!routes.some((r) => r._id === editing._id)}
          onClose={() => setEditing(null)}
          onSave={(route) => {
            onSave(route);
            setEditing(null);
          }}
          onDelete={(id) => {
            onDelete(id);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
