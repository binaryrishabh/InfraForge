import { Command } from 'lucide-react'

const Footer = () => {
  const navLinks = [
    { label: 'How it works', href: '#how-it-works' },
    { label: 'Features', href: '#features' },
    { label: 'Scenarios', href: '#scenarios' },
    { label: 'GitHub', href: 'https://github.com/rishavvrajj/InfraForge' },
  ]

  return (
    <footer className='w-[90%] mx-auto py-10'>
      <div className='container mx-auto'>
        <div className='rounded-xl border border-white/10 bg-[#0A0A0A]/80 px-6 py-7 md:px-8'>
          <div className='flex flex-col gap-7 md:flex-row md:items-center md:justify-between'>
            {/* Brand */}
            <div>
              <a
                href='#home'
                className='flex w-fit items-center gap-2 transition hover:text-indigo-200'
              >
                <Command className='h-4 w-4 text-indigo-400' />
                <span className='clash-display text-base text-zinc-100'>
                  InfraForge
                </span>
              </a>

              <p className='mt-2 max-w-sm text-xs leading-relaxed text-zinc-400'>
                Design, simulate, and stress-test cloud architectures safely.
              </p>
            </div>

            {/* Navigation */}
            <nav
              aria-label='Footer navigation'
              className='flex flex-wrap gap-x-5 gap-y-2'
            >
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target={link.label === 'GitHub' ? '_blank' : undefined}
                  rel={link.label === 'GitHub' ? 'noreferrer' : undefined}
                  className='text-xs text-zinc-400 transition-colors hover:text-indigo-300'
                >
                  {link.label}
                </a>
              ))}
            </nav>
          </div>

          <div className='mt-7 border-t border-white/10 pt-5'>
            <p className='text-center text-xs text-zinc-500'>
              © {new Date().getFullYear()} InfraForge. Built for better systems.
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}

export default Footer