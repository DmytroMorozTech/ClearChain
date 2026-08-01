import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { ShieldCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import { ApiError } from '../api/client.ts';
import { useLogin } from '../api/queries.ts';

export function LoginPage() {
  const login = useLogin();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    login.mutate({ username, password });
  }

  return (
    <Box
      sx={{
        // `dvh`, not `vh`: on mobile browsers `100vh` is the viewport with the URL bar
        // collapsed, so the card sits below the fold until the user scrolls.
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        backgroundColor: 'background.default',
        p: 2,
      }}
    >
      <Paper variant="outlined" sx={{ p: 4, width: '100%', maxWidth: 400 }}>
        <Stack spacing={3} component="form" onSubmit={handleSubmit}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            <ShieldCheck size={28} color="#4F46E5" strokeWidth={2.2} aria-hidden />
            <Typography variant="h5" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
              ClearChain
            </Typography>
          </Stack>

          <Typography color="text.secondary" variant="body2">
            Compliance tracking for a fictional apparel buyer: suppliers across three tiers, the
            certificates they hold, and a risk score derived from both.
          </Typography>

          {/* The server's own message, verbatim. It is deliberately vague about which
              field was wrong, so the form cannot be used to discover valid usernames. */}
          {login.isError && (
            <Alert severity="error">
              {login.error instanceof ApiError ? login.error.message : 'Sign-in failed'}
            </Alert>
          )}

          <TextField
            label="Username"
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
            }}
            autoComplete="username"
            autoFocus
            fullWidth
            required
          />

          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            autoComplete="current-password"
            fullWidth
            required
          />

          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={login.isPending || username === '' || password === ''}
          >
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </Button>

          {/* Below the button, so it never delays a reader who already holds the
              credentials. The credentials themselves stay off this page on purpose —
              they travel with the link that shares the demo, rather than being printed
              beside the lock. */}
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
            An independent portfolio project — the buyer and its suppliers are invented.{' '}
            <Link
              href="https://github.com/DmytroMorozTech/ClearChain"
              target="_blank"
              rel="noopener noreferrer"
            >
              Source and design notes
            </Link>
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}
