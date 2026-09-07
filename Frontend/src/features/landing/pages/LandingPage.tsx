import NavBar from '../components/NavBar';
import HeroSection from '../views/HeroSection'
import Footer from '../components/Footer'

export function LandingPage() {

  return (
    <div className='min-h-screen bg-black text-white'>
      <NavBar />
      <HeroSection />
      <Footer />
    </div>
  );
}