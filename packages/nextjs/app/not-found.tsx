import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl p-6 space-y-3">
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="text-zinc-400">This page doesn&apos;t exist in the demo.</p>
      <Link href="/" className="text-blue-400 underline">
        Back to demo
      </Link>
    </main>
  );
}
