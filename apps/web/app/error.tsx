'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="error-screen">
      <h1>The workbench could not open</h1>
      <p>Your browser draft has not been removed.</p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
