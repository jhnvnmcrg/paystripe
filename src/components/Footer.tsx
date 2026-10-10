export default function Footer() {
  return (
    <footer className="site-footer mt-20 px-4 pb-12 pt-8 text-ink-soft">
      <div className="page-wrap flex flex-col items-center justify-between gap-2 text-center text-sm sm:flex-row sm:text-left">
        <p className="m-0">
          Stripe Lab runs against a Stripe sandbox. No real money moves.
        </p>
        <p className="m-0">Built with TanStack Start</p>
      </div>
    </footer>
  )
}
