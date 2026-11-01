import { expect, test } from "bun:test";
import { capacitySetup } from "./queueCapacity.fixture";
import { hash } from "./asyncCanvas.fixture";

// LF-normalized SHA-256 captured on untouched 79ebcbdbf115f3d2e63f7a85bd6f61d1542c67f9. Never regenerate.
const pins = [
  [
    "normal",
    "82a9673cb4b36f8a2c5fe4d3d2ee13b6d372555602ed45441d327fec578e9c4f",
    "8e58f8694d985ea4247154eab49ce1a98994dd2f2beb55f6b57e05cb5bfd1d46",
    "fde40806e9d0323e26c114c1bfa80166dd32ac18143f4be8be149f64c85aad03",
    "813b1d20bc65c2a53b60e496d2b8b2d68e84c8a682d8b7ead4300cbe1e5a10c1"
  ],
  [
    "poison",
    "ad8c9d272e732af57ee3150cf0c42c1ea958b3dfca8e1a04123c410301d43643",
    "fa041402c77d97deca3b540994fda44984d6a7db4a993c5cc06c19a2aa945eff",
    "978f25db11b8764762560710dd869af6ad47a3505fa7f74b4274002e12e7438f",
    "17563c1c38bf719ce1bbfb4f6473456a971edfab9d60707a1588f298b8747fc9"
  ],
  [
    "outage",
    "de22f145edac023b4fd54244fd246b0ba4e3ff595a28aadb83bb5a085cb72ba6",
    "b2b3048a5052c3f818a7fe0d1c27e24bba611f04b7db6bc8adc5cf3ad425399a",
    "fde40806e9d0323e26c114c1bfa80166dd32ac18143f4be8be149f64c85aad03",
    "a998fdd5060592e38153247534923134ca863abaccd1e673b27a69b89531fb2f"
  ],
  [
    "visibility",
    "3e39ee1e2955bc0b393519fad5b045fcdc9ad3fc86ce9ed7daaa2a8a4912ac9f",
    "dee1a747a440724528b439bffc44dad1fc3d1af4b0042ce5b768e2e75661ae84",
    "fde40806e9d0323e26c114c1bfa80166dd32ac18143f4be8be149f64c85aad03",
    "327237a517f21731f7c904190bb6b3fd3f1e4b2e804a0f038e093733ee80f464"
  ],
  [
    "parallel",
    "54aa2e39c82ff0f735e975ed240841c071374946995a71577b32a35eea4642f1",
    "4aad81f5f4777cd884bf2bde27581df4fc49010a1ce61216166ce9ef761a1606",
    "3bd192b5b464c35ecfb968df485f08a3e41984f27ab50a46a7f0951179631023",
    "0f1512b3ee941802d0a6b2287d8cf72a506829279471c2103e46c3777fa4ee9a"
  ],
  [
    "capacity",
    "124331c10173cb71aff1e39a251459575e6811df97d2917ddcac6efb641ad103",
    "9b264f00db6579307f2a621e5099da427a9d6a67433cd2d76cf8e27782f31134",
    "0e227af12906a84c432f25daa477a62a361517fd0182160d42fcbed50aee8d7d",
    "4a92ac10d7306dfdb6c79a96f0d3b86d09823a86f106c7bb789610c21b6ab590"
  ]
] as const;
for (const [mode, ...expected] of pins) test(`Queue Depth 2 historical compatibility: ${mode}`, () => {
  const f = mode === "capacity" ? capacitySetup("normal", 3) : capacitySetup(mode);
  f.runtime.advanceTo(70_000_000);
  expect([hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual(expected);
});
