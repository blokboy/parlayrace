import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

const UsernameVerificationPage = () => {
  const [username, setUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);

    const response = await fetch('/api/user-profile', {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      setError(payload.message ?? 'Unable to save username.');
      setSubmitting(false);
      return;
    }

    window.location.assign('/dashboard');
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
        <h1 className="font-semibold text-2xl text-slate-900">
          Choose a username
        </h1>
        <p className="mt-2 text-slate-600 text-sm">
          This is required before you can access your account.
        </p>

        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => void submit(event)}
        >
          <input
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Username"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />

          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700 text-sm">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-violet-600 px-4 py-2 font-semibold text-sm text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Saving...' : 'Continue'}
          </button>
        </form>
      </section>
    </main>
  );
};

export const Route = createFileRoute('/auth/username')({
  component: UsernameVerificationPage,
});
