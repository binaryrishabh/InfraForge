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
      <div className='relative z-10'>
        {/* Eyebrow badge */}
        <div className='mb-5 flex w-fit items-center gap-2 rounded-full border border-[rgba(91,140,255,0.25)] bg-[rgba(91,140,255,0.10)] px-3 py-1.5 text-xs text-[#7AA2FF]'>
          <Command size={14} />
          Cloud infrastructure simulation playground
        </div>

        <h1 className='w-[95%] text-4xl md:text-7xl mb-5 tracking-tight text-left leading-[1.05]'>
          <span className='font-semibold tracking-tight bg-linear-to-r from-[#5B8CFF] to-[#7AA2FF] bg-clip-text text-transparent'>
            Build systems that
          </span>
          <br />
          <span className='font-semibold tracking-tight text-[#EDF1F7]'>
            survive the real world.
          </span>
        </h1>

        <p className='text-sm lg:text-lg leading-relaxed text-[#AAB4C5] mb-8 text-left w-full md:w-[70%] lg:w-[62%]'>
          Design cloud architectures, simulate real traffic, and safely inject
          failures to discover bottlenecks before your users do.
          <span className='text-[#EDF1F7]'>
            {' '}Build. Deploy. Break. Learn.
          </span>
        </p>

        <div className='flex flex-row gap-4 items-center'>
          {/* Primary CTA — accent solid */}
          <button onClick={handleStartBuilding} className='group flex items-center gap-2 bg-[#5B8CFF] text-xs lg:text-base font-semibold tracking-tight text-[#081018] px-3 lg:px-5 py-2.5 lg:py-3 rounded-xl lg:rounded-2xl cursor-pointer hover:-translate-y-1 transition hover:bg-[#7AA2FF]'>
            Start Building
            <ArrowRight
              size={17}
              className='transition-transform group-hover:translate-x-1'
            />
          </button>
          {/* Secondary CTA — ghost */}
          <button onClick={handleExploreDemo} className='bg-[#171C27] border border-[#273042] text-[#EDF1F7] text-xs lg:text-base font-semibold tracking-tight px-3 lg:px-5 py-2.5 lg:py-3 rounded-xl lg:rounded-2xl cursor-pointer hover:-translate-y-1 transition hover:border-[#35415A] hover:bg-[#232B3B]'>
            Explore Demo
          </button>
        </div>
      </div>

      {/* Product shot */}
      <div className='relative mx-auto mt-10'>
        <div className='bg-[#12161F]/80 backdrop-blur-md border border-[#273042] rounded-xl overflow-hidden'>
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