export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center px-6 py-20 sm:px-10">
      <section aria-labelledby="foundation-heading" className="max-w-3xl">
        <p className="mb-5 text-sm font-semibold tracking-[0.18em] text-emerald-800 uppercase">
          AI Shopping
        </p>
        <h1
          id="foundation-heading"
          className="text-4xl leading-tight font-semibold tracking-[-0.035em] text-stone-950 sm:text-6xl"
        >
          A better way to decide what to buy.
        </h1>
        <p className="mt-7 max-w-2xl text-lg leading-8 text-stone-600">
          The application foundation is ready. The fixture-driven shopping
          experience begins in V0-02.
        </p>
      </section>
    </main>
  );
}
