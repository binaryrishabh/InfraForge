import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'

export default function NavBar() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const navItems = [
    { label: 'How It Works', href: '/' },
    { label: 'Features', href: '/' },
    { label: 'Scenarios', href: '/' },
  ]

  return (
    <header
      id='navbar'
      className={`fixed top-3.5 left-1/2 z-50 -translate-x-1/2 transition-all duration-500 ${isScrolled
        ? 'h-16 w-[90%] scale-95 rounded-full border border-[#273042] bg-[#0B0E14]/80 backdrop-blur-xl'
        : 'h-16 w-[95%] rounded-3xl border border-[#273042] bg-[#0B0E14]/70 backdrop-blur-xl'
        }`}
    >
      <div className='h-full px-5 md:px-6'>
        <nav className='flex h-full items-center justify-between'>
          {/* Logo */}
          <a href='/' className='flex items-center space-x-2 cursor-pointer'>
            <img
              src="/favicon.png"
              alt="InfraForge"
              className='h-6 w-6'
            />
            <span className='text-sm font-semibold tracking-tight text-[#EDF1F7] lg:text-base'>
              InfraForge
            </span>
          </a>

          {/* Desktop navigation */}
          <div className='hidden items-center space-x-6 lg:space-x-12 md:flex'>
            {navItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className='text-sm text-[#AAB4C5] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:text-[#7AA2FF]'
              >
                {item.label}
              </a>
            ))}
          </div>

          {/* Desktop CTA — primary, accent solid */}
          <a
            href='/dashboard'
            className='hidden items-center rounded-full bg-[#5B8CFF] px-4 py-2 text-sm font-semibold tracking-tight text-[#081018] transition-all duration-200 ease-out hover:scale-105 hover:bg-[#7AA2FF] md:flex'
          >
            Launch Simulator
          </a>

          {/* Mobile toggle */}
          <button
            type='button'
            onClick={() => setIsMenuOpen((open) => !open)}
            aria-label='Toggle navigation menu'
            aria-expanded={isMenuOpen}
            className='bg-[#12161F]/80 backdrop-blur-md border border-[#273042] rounded-md p-2 transition-transform hover:scale-105 md:hidden'
          >
            {isMenuOpen ? (
              <X className='h-4 w-4 text-[#EDF1F7]' />
            ) : (
              <Menu className='h-4 w-4 text-[#EDF1F7]' />
            )}
          </button>
        </nav>
      </div>

      {/* Mobile navigation */}
      {isMenuOpen && (
        <div className='absolute left-0 top-[calc(100%+0.75rem)] w-full rounded-2xl border border-[#273042] bg-[#12161F]/95 p-4 backdrop-blur-xl md:hidden'>
          <div className='flex flex-col gap-2'>
            {navItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                onClick={() => setIsMenuOpen(false)}
                className='rounded-xl px-3 py-2.5 text-sm text-[#AAB4C5] transition hover:bg-[rgba(91,140,255,0.10)] hover:text-[#7AA2FF]'
              >
                {item.label}
              </a>
            ))}
            <a
              href='/dashboard'
              onClick={() => setIsMenuOpen(false)}
              className='mt-2 rounded-xl bg-[#5B8CFF] px-3 py-2.5 text-center text-sm font-semibold tracking-tight text-[#081018] transition-colors hover:bg-[#7AA2FF]'
            >
              Launch Simulator
            </a>
          </div>
        </div>
      )}
    </header>
  )
}