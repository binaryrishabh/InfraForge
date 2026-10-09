import NavBar from '../components/NavBar';
import HeroSection from '../views/HeroSection'
import Footer from '../components/Footer'

export function LandingPage() {
  return (
    <div className='min-h-screen bg-[#0B0E14] text-[#EDF1F7]'>
      <NavBar />
      <HeroSection />
      <Footer />
    </div>
  );
}