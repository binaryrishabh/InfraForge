import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Command, ArrowRight } from 'lucide-react'

export default function HeroSection() {
  const navigate = useNavigate()

  const handleStartBuilding = () => {
    navigate('/signin')
  }

  const handleExploreDemo = () => {
    navigate('/signup')
  }
  return (
    <section className='relative container left-1/2 -translate-x-1/2 w-[90%] pt-24 pb-10 lg:pt-30'>
      <div className='relative z-1'>
        <div className='mb-5 flex w-fit items-center gap-2 rounded-full border border-indigo-400/20 bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-200'>
          <Command size={14} />
          Cloud infrastructure simulation playground
        </div>

        <h1 className='w-[95%] text-4xl md:text-7xl mb-5 tracking-tight text-left leading-[1.05]'>
          <span className='clash-display grad1'>
            Build systems that
          </span>
          <br />
          <span className='text-zinc-50 font-medium clash-display'>
            survive the real world.
          </span>
        </h1>

        <p className='text-sm lg:text-lg leading-relaxed text-zinc-300/80 mb-8 text-left w-full md:w-[70%] lg:w-[62%]'>
          Design cloud architectures, simulate real traffic, and safely inject
          failures to discover bottlenecks before your users do.
          <span className='text-zinc-100'>
            {' '}Build. Deploy. Break. Learn.
          </span>
        </p>

        <div className='flex flex-row gap-4 items-center'>
          <button onClick={handleStartBuilding} className='group flex items-center gap-2 bg-indigo-500 text-xs lg:text-base clash-display px-3 lg:px-5 py-2.5 lg:py-3 rounded-xl lg:rounded-2xl cursor-pointer hover:-translate-y-1 transition hover:bg-indigo-400'>
            Start Building
            <ArrowRight
              size={17}
              className='transition-transform group-hover:translate-x-1'
            />
          </button>

          <button onclick={handleExploreDemo} className='text-zinc-100 text-xs lg:text-base clash-display px-3 lg:px-5 py-2.5 lg:py-3 rounded-xl lg:rounded-2xl cursor-pointer hover:-translate-y-1 transition hover:bg-indigo-500/20'>
            Explore Demo
          </button>
        </div>
      </div>

      <div className='relative mx-auto mt-10'>
        <div className='glass rounded-xl overflow-hidden'>
          <img
            src="/dashboard.png"
            alt="InfraForge cloud infrastructure simulation dashboard"
            className='w-full h-auto'
          />
        </div>
      </div>
    </section>
  )
}