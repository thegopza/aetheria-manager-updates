// ==========================================================================
// PLAN SCRIPT: AUTO CLASS SELECTION, SKILL BUILDER & STAT BUILDER ENGINE
// ==========================================================================

const CLASS_TREE_MAP = {
  archer: {
    name: 'Archer (นักธนู)',
    secondClasses: [
      { id: 'hunter', name: 'Hunter (นักล่า)' },
      { id: 'bard', name: 'Bard (กวี)' },
      { id: 'dancer', name: 'Dancer (นักเต้น)' }
    ]
  },
  swordsman: {
    name: 'Swordsman (นักดาบ)',
    secondClasses: [
      { id: 'knight', name: 'Knight (อัศวิน)' },
      { id: 'crusader', name: 'Crusader (ครูเซเดอร์)' }
    ]
  },
  mage: {
    name: 'Mage (นักเวท)',
    secondClasses: [
      { id: 'wizard', name: 'Wizard (จอมเวท)' },
      { id: 'sage', name: 'Sage (นักปราชญ์)' }
    ]
  },
  thief: {
    name: 'Thief (โจร)',
    secondClasses: [
      { id: 'assassin', name: 'Assassin (นักฆ่า)' },
      { id: 'rogue', name: 'Rogue (โร้ก)' }
    ]
  },
  acolyte: {
    name: 'Acolyte (นักบวชฝึกหัด)',
    secondClasses: [
      { id: 'priest', name: 'Priest (พรีสต์)' },
      { id: 'monk', name: 'Monk (มองค์)' }
    ]
  },
  merchant: {
    name: 'Merchant (พ่อค้า)',
    secondClasses: [
      { id: 'blacksmith', name: 'Blacksmith (ช่างตีเหล็ก)' },
      { id: 'alchemist', name: 'Alchemist (นักเล่นแร่แปรธาตุ)' }
    ]
  }
};

// Generated from the game's own skill catalog (window.__skillCatalog): names, learnable max level and
// prerequisites match the game. Regenerate when the game adds skills.
const SKILLS_DATABASE = { "novice": [
    {"id":"basic-skill","name":"Adventurer's Instinct","thai":"ทักษะพื้นฐาน","maxLevel":9,"kind":"passive","desc":"ทักษะพื้นฐานของนักผจญภัย ต้องฝึกจนถึง Lv.9 จึงเปลี่ยนอาชีพได้"},
    {"id":"first-aid","name":"Field Mend","thai":"ปฐมพยาบาล","maxLevel":1,"kind":"active","desc":"ทำแผลเบื้องต้นให้ตัวเอง ฟื้นฟู HP เล็กน้อย"}
  ], "swordsman": [
    {"id":"sword-mastery","name":"Blade Mastery","thai":"ชำนาญดาบ","maxLevel":10,"kind":"passive","desc":"เพิ่มพลังโจมตีเมื่อใช้ดาบ เป็นพื้นฐานของสายนักดาบ"},
    {"id":"bash","name":"Crushing Blow","thai":"ฟันกระแทก","maxLevel":10,"kind":"active","desc":"ฟันศัตรูอย่างรุนแรง ตั้งแต่ Lv.6 มีโอกาสทำให้เป้าหมายมึนงง","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"crushing-blow","name":"Crushing Blow","thai":"ทุบสะท้าน","desc":"โอกาส 14% มึน 1.5 วิ"}]},{"lv":12,"opts":[{"id":"lingering","name":"Lingering","thai":"สถานะยืดเยื้อ","desc":"เวลาสถานะที่สกิลทำ +56%"},{"id":"cleave","name":"Cleave","thai":"ฟันกวาด","desc":"ศัตรูรอบเป้าในระยะ 1 ช่อง โดน 82% ของดาเมจสกิลด้วย (ใช้กับสกิลเป้าเดียว)"},{"id":"executioner","name":"Executioner","thai":"เพชฌฆาต","desc":"ดาเมจ +566% กับเป้าที่เลือดต่ำกว่า 30%"}]},{"lv":15,"opts":[{"id":"overload","name":"Overload","thai":"ทุ่มสุดตัว","desc":"ดาเมจ +60% แต่คูลดาวน์ +50%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"overkill","name":"Overkill","thai":"ดาเมจล้น","desc":"ดาเมจที่เกินตอนฆ่า 167% ไหลไปศัตรูใกล้สุดใน 5 ช่อง"}]}]},
    {"id":"provoke","name":"Challenger's Roar","thai":"ยั่วยุ","maxLevel":10,"kind":"active","desc":"ยั่วยุศัตรูทุกตัวในรัศมี 5 ช่องรอบตัวให้หันมาสู้ (ดึงมอน) และลดพลังป้องกันของพวกมัน (ไม่มีผลกับเผ่า Undead) · สาย Crusader: มอนที่โดนยั่วยุต...","facets":[{"lv":3,"opts":[{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"},{"id":"deep-curse","name":"Deep Curse","thai":"คำสาปลึก","desc":"ค่าที่ดีบัฟของสกิลนี้ลด (DEF / ATK / ความเร็ว ฯลฯ) แรงขึ้น 10%"}]},{"lv":6,"opts":[{"id":"lingering","name":"Lingering","thai":"สถานะยืดเยื้อ","desc":"เวลาสถานะที่สกิลทำ +56%"},{"id":"contagion","name":"Contagion","thai":"ดีบัฟลาม","desc":"ดีบัฟของสกิลนี้ลามไปมอนรอบเป้า 2 ช่อง 55% ของความแรงและเวลา (สูงสุด 3 ตัว ไม่รวมบอส ไม่ลามต่อ)"},{"id":"exploit","name":"Exploit","thai":"ซ้ำเติม","desc":"มอนที่ติดสถานะ / ดีบัฟจากสกิลนี้รับดาเมจจากทุกคนเพิ่ม 8% (บอสครึ่งหนึ่ง)"}]},{"lv":10,"opts":[{"id":"master","name":"Master","thai":"ชำนาญ","desc":"คูลดาวน์ -50%, เวลาร่าย -50%"},{"id":"free","name":"Effortless","thai":"ไร้แรง","desc":"SP -70%"},{"id":"long-reach","name":"Long Reach","thai":"ระยะไกล","desc":"ระยะร่าย +3 ช่อง"}]}]},
    {"id":"hp-recovery","name":"Iron Vitality","thai":"ฟื้นฟูพลังชีวิต","maxLevel":10,"kind":"passive","desc":"เพิ่มการฟื้นฟู HP ตามธรรมชาติ"},
    {"id":"magnum-break","name":"Inferno Burst","thai":"ระเบิดเพลิง","maxLevel":10,"kind":"active","req":"ฟันกระแทก Lv.3","prereq":[{"skill":"bash","level":3}],"desc":"ระเบิดพลังเพลิงรอบตัว ทำความเสียหายธาตุไฟต่อศัตรูรอบด้าน และผลักศัตรูที่โดนกระเด็น 2 ช่อง หลังใช้ได้รับบัพ ความเสียหายกายภาพ +10% เป็นเวลา 2...","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"ignite","name":"Ignite","thai":"เพลิงลาม","desc":"ศัตรูที่โดนติดไฟ เผาไหม้ 30% ของดาเมจต่อวิ 3 วิ"}]},{"lv":12,"opts":[{"id":"vortex","name":"Vortex","thai":"วังวน","desc":"ดูดศัตรูในพื้นที่เข้าหากลางวง 1.5 ช่องก่อนโดน"},{"id":"epicenter","name":"Epicenter","thai":"จุดศูนย์กลาง","desc":"ศัตรูกลางวง 1 ช่องรับดาเมจ +184%"},{"id":"concussive","name":"Concussive","thai":"แรงกระแทก","desc":"ศัตรูที่โดนช้าลง 28% 3 วิ"}]},{"lv":15,"opts":[{"id":"overload","name":"Overload","thai":"ทุ่มสุดตัว","desc":"ดาเมจ +60% แต่คูลดาวน์ +50%"},{"id":"wider","name":"Vast","thai":"กว้างไกล","desc":"พื้นที่ +2 ช่อง แต่ดาเมจ -15%"},{"id":"aftershock","name":"Aftershock","thai":"แรงสั่นสะเทือน","desc":"พื้นสั่นซ้ำหลัง 1 วิ ทุกตัวในพื้นที่โดน 216% ของดาเมจสกิล"}]}]},
    {"id":"endure","name":"Unbroken Will","thai":"จิตมั่นคง","maxLevel":10,"kind":"active","req":"ยั่วยุ Lv.3","prereq":[{"skill":"provoke","level":3}],"desc":"ตั้งสติต้านทานการโจมตี เพิ่มพลังป้องกันเวทชั่วคราว","facetsPending":true}
  ], "mage": [
    {"id":"staff-mastery","name":"Arcane Focus","thai":"ชำนาญไม้เท้า","maxLevel":10,"kind":"passive","desc":"ถือไม้เท้า MATK +3 ต่อเลเวล (Lv.10 = +30)"},
    {"id":"sp-recovery","name":"Mana Flow","thai":"ฟื้นฟูพลังเวท","maxLevel":10,"kind":"passive","desc":"เพิ่มการฟื้นฟู SP ตามธรรมชาติ"},
    {"id":"fire-bolt","name":"Flame Lance","thai":"ศรเพลิง","maxLevel":10,"kind":"active","desc":"ยิงศรเพลิงตามจำนวนเลเวลสกิล ธาตุไฟ","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"ignite","name":"Ignite","thai":"ติดไฟ","desc":"ศัตรูที่โดนติดไฟ เผา 30% ของดาเมจต่อวิ 3 วิ"}]},{"lv":12,"opts":[{"id":"fork","name":"Fork","thai":"แตกลูก","desc":"แตก 2 ลูกไปหาศัตรูอื่นใกล้เป้า 3 ช่อง ลูกละ 101%"},{"id":"blast","name":"Blast","thai":"ระเบิดเพลิง","desc":"ระเบิดรอบเป้า 1 ช่อง 99%"},{"id":"overheat","name":"Overheat","thai":"ร้อนจัด","desc":"ดาเมจ +35% แต่คูลดาวน์ +40%"}]},{"lv":15,"opts":[{"id":"flame-spear","name":"Flame Spear","thai":"หอกเพลิง","desc":"รวมทุกลูกเป็นหอกเพลิงเล่มเดียว แรงเท่าทุกลูกรวมกัน ทะลุศัตรูด้านหลัง 4 ช่อง 112%"},{"id":"barrage","name":"Flame Barrage","thai":"ห่าเพลิง","desc":"ยิงเพิ่ม 4 ลูก แต่ละลูกดาเมจ -25%"},{"id":"phoenix-chain","name":"Phoenix Chain","thai":"เพลิงกระโดด","desc":"ไฟกระโดดต่อ 3 ตัวในระยะ 4 ช่อง ตัวละ 73%"}]}]},
    {"id":"cold-bolt","name":"Frost Lance","thai":"ศรน้ำแข็ง","maxLevel":10,"kind":"active","desc":"ยิงศรน้ำแข็งตามจำนวนเลเวลสกิล ธาตุน้ำ","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"frostbite","name":"Frostbite","thai":"เยือกแข็ง","desc":"โอกาส 5% แช่แข็ง 2 วิ"}]},{"lv":12,"opts":[{"id":"fork","name":"Fork","thai":"แตกลูก","desc":"แตก 2 ลูกไปหาศัตรูอื่นใกล้เป้า 3 ช่อง ลูกละ 101%"},{"id":"shatter","name":"Shatter","thai":"แตกละเอียด","desc":"ศัตรูที่แข็งอยู่โดนแรงขึ้น 55% แล้วหลุดแข็ง"},{"id":"lingering","name":"Lingering Cold","thai":"หนาวนาน","desc":"เวลาสถานะที่สกิลทำ +28%"}]},{"lv":15,"opts":[{"id":"glacier-lance","name":"Glacier Lance","thai":"หอกธารน้ำแข็ง","desc":"รวมทุกลูกเป็นหอกน้ำแข็งเล่มเดียว แรงเท่าทุกลูกรวมกัน โอกาสแช่แข็ง 12%"},{"id":"barrage","name":"Frost Barrage","thai":"ห่าน้ำแข็ง","desc":"ยิงเพิ่ม 4 ลูก แต่ละลูกดาเมจ -25%"},{"id":"ice-chain","name":"Ice Chain","thai":"น้ำแข็งกระโดด","desc":"น้ำแข็งกระโดดต่อ 3 ตัวในระยะ 4 ช่อง ตัวละ 73%"}]}]},
    {"id":"lightning-bolt","name":"Thunder Lance","thai":"ศรสายฟ้า","maxLevel":10,"kind":"active","desc":"ยิงศรสายฟ้าตามจำนวนเลเวลสกิล ธาตุลม","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"jolt","name":"Jolt","thai":"ช็อต","desc":"โอกาส 7% มึน 1.5 วิ"}]},{"lv":12,"opts":[{"id":"chain","name":"Chain","thai":"สายฟ้ากระโดด","desc":"สายฟ้ากระโดดต่อ 3 ตัวในระยะ 4 ช่อง ตัวละ 66%"},{"id":"static","name":"Static","thai":"ประจุไฟฟ้า","desc":"ฟ้าผ่าต่อจากตัวแรก 2 ตัวในระยะ 5 ช่อง ตัวละ 266%"},{"id":"fork","name":"Fork","thai":"แตกลูก","desc":"แตก 2 ลูกไปหาศัตรูอื่นใกล้เป้า 3 ช่อง ลูกละ 101%"}]},{"lv":15,"opts":[{"id":"thunder-spear","name":"Thunder Spear","thai":"หอกอัสนี","desc":"รวมทุกลูกเป็นสายฟ้าเส้นเดียว แรงเท่าทุกลูกรวมกัน โอกาสมึน 14%"},{"id":"barrage","name":"Bolt Storm","thai":"พายุสายฟ้า","desc":"ยิงเพิ่ม 4 ลูก แต่ละลูกดาเมจ -25%"},{"id":"storm-lance","name":"Storm Lance","thai":"หอกพายุ","desc":"ฟ้าผ่าต่อจากตัวแรก 3 ตัวในระยะ 5 ช่อง ตัวละ 305%"}]}]},
    {"id":"soul-strike","name":"Spirit Barrage","thai":"ดวงวิญญาณพุ่งชน","maxLevel":10,"kind":"active","desc":"ปล่อยดวงวิญญาณธาตุวิญญาณ จำนวนลูกเพิ่มทุก 2 เลเวล","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"}]},{"lv":12,"opts":[{"id":"fork","name":"Fork","thai":"วิญญาณแยก","desc":"แตก 2 ลูกไปหาศัตรูอื่นใกล้เป้า 3 ช่อง ลูกละ 101%"},{"id":"reaper","name":"Reaper","thai":"เก็บวิญญาณ","desc":"เป้าเลือดต่ำกว่า 30% โดนแรงขึ้น 566%"},{"id":"more-souls","name":"More Souls","thai":"วิญญาณเพิ่ม","desc":"วิญญาณเพิ่ม 2 ลูก แต่ละลูกดาเมจ -15%"}]},{"lv":15,"opts":[{"id":"soul-lance","name":"Soul Lance","thai":"หอกวิญญาณ","desc":"รวมทุกลูกเป็นหอกวิญญาณเล่มเดียว แรงเท่าทุกลูกรวมกัน ทะลุศัตรูด้านหลัง 4 ช่อง 112%"},{"id":"soul-chain","name":"Soul Chain","thai":"วิญญาณกระโดด","desc":"วิญญาณกระโดดต่อ 3 ตัวในระยะ 4 ช่อง ตัวละ 73%"},{"id":"soul-reap","name":"Soul Reap","thai":"สูบวิญญาณ","desc":"ฟื้น HP 10% ของดาเมจ และเป้าเลือดต่ำกว่า 30% โดนแรงขึ้น 694%"}]}]},
    {"id":"napalm-beat","name":"Psychic Burst","thai":"คลื่นจิต","maxLevel":10,"kind":"active","desc":"คลื่นพลังจิตระเบิดรอบเป้าหมาย ธาตุวิญญาณ","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"}]},{"lv":12,"opts":[{"id":"wide","name":"Wide","thai":"แผ่กว้าง","desc":"พื้นที่ +1 ช่อง"},{"id":"daze","name":"Daze","thai":"มึนงง","desc":"ศัตรูที่โดนช้าลง 14% 3 วิ"},{"id":"pull","name":"Pull","thai":"ดึงจิต","desc":"ดูดศัตรูเข้ากลางวง 1 ช่องก่อนโดน"}]},{"lv":15,"opts":[{"id":"mind-crush","name":"Mind Crush","thai":"บดจิต","desc":"ศัตรูกลางวง 1 ช่องโดนแรงขึ้น 217%"},{"id":"psychic-cascade","name":"Psychic Cascade","thai":"คลื่นจิตซ้อน","desc":"เกิดวงเล็กซ้ำ 2 จุดรอบวง ดาเมจ 114% ของทั้งสกิล"},{"id":"echo-burst","name":"Echo Burst","thai":"คลื่นจิตสะท้อน","desc":"พื้นที่ระเบิดซ้ำหลัง 1 วิ ทุกตัวโดน 216%"}]}]},
    {"id":"frost-diver","name":"Glacial Spike","thai":"ธาราเยือกแข็ง","maxLevel":10,"kind":"active","req":"ศรน้ำแข็ง Lv.5","prereq":[{"skill":"cold-bolt","level":5}],"desc":"ยิงคลื่นน้ำแข็ง มีโอกาสแช่แข็งเป้าหมาย","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"lingering","name":"Lingering Cold","thai":"หนาวนาน","desc":"เวลาแช่แข็ง +18%"}]},{"lv":12,"opts":[{"id":"splinter","name":"Splinter","thai":"เศษน้ำแข็ง","desc":"น้ำแข็งแตกโดนศัตรูรอบเป้า 1 ช่อง 82%"},{"id":"shatter","name":"Shatter","thai":"แตกละเอียด","desc":"ศัตรูที่แข็งอยู่โดนแรงขึ้น 55% แล้วหลุดแข็ง"},{"id":"deep-freeze","name":"Deep Freeze","thai":"แช่แข็งลึก","desc":"โอกาสแช่แข็งเพิ่มอีก 9% 2 วิ"}]},{"lv":15,"opts":[{"id":"ice-prison","name":"Ice Prison","thai":"คุกน้ำแข็ง","desc":"โอกาสแช่แข็งเพิ่ม 12% และแข็งนานขึ้น 35%"},{"id":"frost-nova","name":"Frost Nova","thai":"ระเบิดหิมะ","desc":"น้ำแข็งแตกโดนรอบเป้า 1 ช่อง 92% และช้าลง 18% 3 วิ"},{"id":"shatter-spike","name":"Shatter Spike","thai":"หนามแตก","desc":"ดาเมจ +20% และศัตรูที่แข็งอยู่โดนแรงขึ้น 65%"}]}]},
    {"id":"sight","name":"Revealing Flame","thai":"ไฟส่องทาง","maxLevel":1,"kind":"active","desc":"เรียกลูกไฟวนรอบตัว 10 วินาที ผู้เล่นฝ่ายศัตรูที่หายตัวอยู่ในรัศมี 6 ช่องจะโผล่ออกมา","facets":[{"lv":1,"opts":[{"id":"far-sight","name":"Far Sight","thai":"ตาไกล","desc":"ระยะมองเห็น +1 ช่อง"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"คูลดาวน์ -50%"}]},{"lv":1,"opts":[{"id":"mark","name":"Mark","thai":"ตีตรา","desc":"มอนที่ถูกเปิดเผยรับดาเมจจากทุกคนเพิ่ม 8% 8 วิ (ไม่เกิน 10 ตัว)"},{"id":"far-sight","name":"Eagle Eye","thai":"ตาเหยี่ยว","desc":"ระยะมองเห็น +2 ช่อง"},{"id":"focus","name":"Deep Focus","thai":"สมาธิลึก","desc":"SP -60%, คูลดาวน์ -30%"}]},{"lv":1,"opts":[{"id":"hunt","name":"Hunter's Flame","thai":"เปลวล่า","desc":"มอนที่ถูกเปิดเผยรับดาเมจจากทุกคนเพิ่ม 10% 8 วิ"},{"id":"beacon","name":"Beacon","thai":"ประภาคาร","desc":"ระยะมองเห็น +2 ช่อง"},{"id":"seer","name":"Seer","thai":"ผู้หยั่งรู้","desc":"ระยะมองเห็น +2 ช่อง และมอนที่ถูกเปิดเผยรับดาเมจเพิ่ม 10%"}]}]}
  ], "archer": [
    {"id":"owl-eye","name":"Keen Eye","thai":"ตานกฮูก","maxLevel":10,"kind":"passive","desc":"สายตาแหลมคม เพิ่ม DEX ถาวร"},
    {"id":"vulture-eye","name":"Eagle Sight","thai":"ตาแร้ง","maxLevel":10,"kind":"passive","req":"ตานกฮูก Lv.3","prereq":[{"skill":"owl-eye","level":3}],"desc":"เพิ่มระยะยิงและความแม่นยำ"},
    {"id":"double-strafe","name":"Twin Shot","thai":"ยิงคู่","maxLevel":10,"kind":"active","desc":"ยิงลูกธนูสองดอกติดกัน","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"}]},{"lv":12,"opts":[{"id":"chain","name":"Chain","thai":"ลูกโซ่","desc":"เด้งต่อไปยังศัตรูตัวที่ใกล้ที่สุดในระยะ 4 ช่อง ทีละตัว 2-3 ตัว แต่ละตัวโดน 66% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"},{"id":"fork","name":"Fork","thai":"แยกทาง","desc":"ยิงเพิ่ม 2 ลูกไปหาศัตรูตัวอื่นที่อยู่ภายใน 3 ช่องรอบเป้า แต่ละลูกโดน 101% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"},{"id":"piercing","name":"Piercing","thai":"ทะลวง","desc":"ทะลุเป้าไปโดนศัตรูทุกตัวด้านหลังในแนวยาว 6 ช่อง กว้าง 2 ช่อง แต่ละตัวโดน 116% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"}]},{"lv":15,"opts":[{"id":"one-strike","name":"One Strike","thai":"รวมพลัง","desc":"ทุกครั้งรวมเป็นครั้งเดียว แรงเท่ารวมกัน ดาเมจ +10%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"detonate","name":"Detonate","thai":"ระเบิดศพ","desc":"ศัตรูที่ตายจากสกิลนี้ระเบิด ทำดาเมจ 90% ของ HP สูงสุดของตัวที่ตาย ใส่ศัตรูรอบ 5 ช่อง (ไม่เกิน 3 เท่าของดาเมจที่ฆ่า) ตัวที่ตายจากแรงระเบิดจะระเบิดต่ออีก 1 ทอด"}]}]},
    {"id":"arrow-shower","name":"Arrow Rain","thai":"ฝนธนู","maxLevel":10,"kind":"active","req":"ยิงคู่ Lv.5","prereq":[{"skill":"double-strafe","level":5}],"desc":"ยิงธนูเป็นห่าฝนลงพื้นที่ที่เลือก โดนศัตรูทุกตัวในวง (ใช้ดึงมอนเป็นกลุ่มได้)","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"concussive","name":"Concussive","thai":"แรงกระแทก","desc":"ศัตรูที่โดนช้าลง 18% 3 วิ"}]},{"lv":12,"opts":[{"id":"aftershock","name":"Aftershock","thai":"แรงสั่นสะเทือน","desc":"พื้นสั่นซ้ำหลัง 1 วิ ทุกตัวในพื้นที่โดน 189% ของดาเมจสกิล"},{"id":"vortex","name":"Vortex","thai":"วังวน","desc":"ดูดศัตรูในพื้นที่เข้าหากลางวง 1.5 ช่องก่อนโดน"},{"id":"epicenter","name":"Epicenter","thai":"จุดศูนย์กลาง","desc":"ศัตรูกลางวง 1 ช่องรับดาเมจ +184%"}]},{"lv":15,"opts":[{"id":"overload","name":"Overload","thai":"ทุ่มสุดตัว","desc":"ดาเมจ +60% แต่คูลดาวน์ +50%"},{"id":"wider","name":"Vast","thai":"กว้างไกล","desc":"พื้นที่ +2 ช่อง แต่ดาเมจ -15%"},{"id":"detonate","name":"Detonate","thai":"ระเบิดศพ","desc":"ศัตรูที่ตายจากสกิลนี้ระเบิด ทำดาเมจ 90% ของ HP สูงสุดของตัวที่ตาย ใส่ศัตรูรอบ 5 ช่อง (ไม่เกิน 3 เท่าของดาเมจที่ฆ่า) ตัวที่ตายจากแรงระเบิดจะระเบิดต่ออีก 1 ทอด"}]}]},
    {"id":"improve-concentration","name":"Hunter's Focus","thai":"เพิ่มสมาธิ","maxLevel":10,"kind":"active","req":"ตาแร้ง Lv.1","prereq":[{"skill":"vulture-eye","level":1}],"desc":"รวบรวมสมาธิ เพิ่ม AGI และ DEX ชั่วคราว","facetsPending":true}
  ], "acolyte": [
    {"id":"heal","name":"Mending Light","thai":"แสงเยียวยา","maxLevel":10,"kind":"active","desc":"ฟื้นฟู HP ให้ตัวเองหรือพันธมิตร ปริมาณขึ้นกับ Base Level และ INT และ INT ทุก 2 แต้มเพิ่มพลังฮีลอีก 1% ใช้กับมอนเผ่า Undead จะทำดาเมจศักดิ์สิ...","facetsPending":true},
    {"id":"divine-protection","name":"Sacred Ward","thai":"พรคุ้มครอง","maxLevel":10,"kind":"passive","desc":"พลังศักดิ์สิทธิ์ปกป้อง ลดดาเมจที่ได้รับจากมอนเผ่า Undead และ Demon"},
    {"id":"blessing","name":"Heaven's Favor","thai":"พรแห่งสวรรค์","maxLevel":10,"kind":"active","req":"พรคุ้มครอง Lv.5","prereq":[{"skill":"divine-protection","level":5}],"desc":"อวยพรให้ STR INT DEX เพิ่มขึ้นชั่วคราว","facetsPending":true},
    {"id":"increase-agi","name":"Swiftness","thai":"เพิ่มความว่องไว","maxLevel":10,"kind":"active","req":"แสงเยียวยา Lv.3","prereq":[{"skill":"heal","level":3}],"desc":"เพิ่ม AGI และความเร็วเคลื่อนที่ชั่วคราว","facetsPending":true},
    {"id":"holy-light","name":"Radiant Smite","thai":"แสงศักดิ์สิทธิ์","maxLevel":5,"kind":"active","desc":"ยิงลำแสงธาตุศักดิ์สิทธิ์ ดาเมจเวท 300% ที่ Lv.1 เพิ่มขึ้นเลเวลละ 50% (500% ที่ Lv.5) มอนเผ่า Undead และ Demon โดนแรงเป็น 2 เท่า","facets":[{"lv":1,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"sanctify","name":"Sanctify","thai":"ชำระบาป","desc":"ดาเมจกับอันเดดและปีศาจ +9%"}]},{"lv":3,"opts":[{"id":"fork","name":"Fork","thai":"แยกทาง","desc":"ยิงเพิ่ม 2 ลูกไปหาศัตรูตัวอื่นที่อยู่ภายใน 3 ช่องรอบเป้า แต่ละลูกโดน 101% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"},{"id":"piercing","name":"Piercing","thai":"ทะลวง","desc":"ทะลุเป้าไปโดนศัตรูทุกตัวด้านหลังในแนวยาว 6 ช่อง กว้าง 2 ช่อง แต่ละตัวโดน 116% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"},{"id":"executioner","name":"Executioner","thai":"เพชฌฆาต","desc":"ดาเมจ +566% กับเป้าที่เลือดต่ำกว่า 30%"}]},{"lv":5,"opts":[{"id":"overload","name":"Overload","thai":"ทุ่มสุดตัว","desc":"ดาเมจ +60% แต่คูลดาวน์ +50%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"chain","name":"Chain","thai":"ลูกโซ่","desc":"เด้งต่อไปยังศัตรูตัวที่ใกล้ที่สุดในระยะ 4 ช่อง ทีละตัว 2-3 ตัว แต่ละตัวโดน 73% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"}]}]},
    {"id":"mace-mastery","name":"Mace Discipline","thai":"ชำนาญกระบอง","maxLevel":10,"kind":"passive","desc":"ถือกระบอง ATK +3 ต่อเลเวล"},
    {"id":"defense-increase","name":"Defense Increase","thai":"เสริมเกราะศรัทธา","maxLevel":10,"kind":"passive","desc":"ศรัทธาเสริมความแข็งแกร่ง เพิ่ม DEF 1% ต่อเลเวล (Lv.10 +10%)"}
  ], "merchant": [
    {"id":"enlarge-weight","name":"Pack Mule","thai":"ขยายน้ำหนักบรรทุก","maxLevel":10,"kind":"passive","desc":"เพิ่มน้ำหนักที่แบกได้"},
    {"id":"discount","name":"Haggler","thai":"ต่อราคา","maxLevel":10,"kind":"passive","req":"ขยายน้ำหนักบรรทุก Lv.3","prereq":[{"skill":"enlarge-weight","level":3}],"desc":"ซื้อของจาก NPC ถูกลง"},
    {"id":"axe-mastery","name":"Axe Discipline","thai":"ชำนาญขวาน","maxLevel":10,"kind":"passive","desc":"ถือขวานมือเดียว ATK +4 ต่อเลเวล"},
    {"id":"mammonite","name":"Gold Smash","thai":"ทุบด้วยเงิน","maxLevel":10,"kind":"active","desc":"ทุ่มเงินทุบศัตรูอย่างแรง ใช้ Zeny ทุกครั้ง","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"crushing-blow","name":"Crushing Blow","thai":"ทุบสะท้าน","desc":"โอกาส 14% มึน 1.5 วิ"}]},{"lv":12,"opts":[{"id":"cleave","name":"Cleave","thai":"ฟันกวาด","desc":"ศัตรูรอบเป้าในระยะ 1 ช่อง โดน 82% ของดาเมจสกิลด้วย (ใช้กับสกิลเป้าเดียว)"},{"id":"executioner","name":"Executioner","thai":"เพชฌฆาต","desc":"ดาเมจ +566% กับเป้าที่เลือดต่ำกว่า 30%"},{"id":"overheat","name":"Overheat","thai":"ทุ่มแรง","desc":"ดาเมจ +35% แต่คูลดาวน์ +40%"}]},{"lv":15,"opts":[{"id":"overload","name":"Overload","thai":"ทุ่มสุดตัว","desc":"ดาเมจ +60% แต่คูลดาวน์ +50%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"detonate","name":"Detonate","thai":"ระเบิดศพ","desc":"ศัตรูที่ตายจากสกิลนี้ระเบิด ทำดาเมจ 90% ของ HP สูงสุดของตัวที่ตาย ใส่ศัตรูรอบ 5 ช่อง (ไม่เกิน 3 เท่าของดาเมจที่ฆ่า) ตัวที่ตายจากแรงระเบิดจะระเบิดต่ออีก 1 ทอด"}]}]},
    {"id":"loud-exclamation","name":"Battle Shout","thai":"ตะโกนปลุกใจ","maxLevel":1,"kind":"active","req":"ต่อราคา Lv.3","prereq":[{"skill":"discount","level":3}],"desc":"ตะโกนปลุกใจตัวเอง เพิ่ม STR และพลังโจมตี"},
    {"id":"hagglers-wit","name":"Haggler's Wit","thai":"ปากหวานต่อราคา","maxLevel":10,"kind":"active","desc":"ใช้ไหวพริบพ่อค้าต่อรองราคา ลด Zeny ที่สกิลใช้ (เช่น ทุบด้วยเงิน) 5% ต่อเลเวล (Lv.10 ลด 50%) นาน 3 นาที"}
  ], "thief": [
    {"id":"dagger-mastery","name":"Dagger Finesse","thai":"ชำนาญมีดสั้น","maxLevel":10,"kind":"passive","desc":"ติดตัว: พลังโจมตีเพิ่มขึ้นเมื่อถือมีดสั้น"},
    {"id":"double-attack","name":"Twin Fang","thai":"โจมตีสองจังหวะ","maxLevel":10,"kind":"passive","desc":"มีโอกาสโจมตีปกติสองครั้งเมื่อใช้มีดสั้น"},
    {"id":"improve-dodge","name":"Evasion Art","thai":"หลบหลีกชำนาญ","maxLevel":10,"kind":"passive","desc":"เพิ่มอัตราการหลบหลีก FLEE +3 ต่อเลเวล · ครบ Lv.10 ได้ FLEE อีก +20"},
    {"id":"steal","name":"Pickpocket","thai":"ขโมย","maxLevel":10,"kind":"active","desc":"ขโมยไอเทมจากมอนสเตอร์ โอกาส 2% ต่อเลเวล (Lv.10 = 20%) + DEX/10 ได้ครั้งเดียวต่อมอนหนึ่งตัว","facets":[{"lv":3,"opts":[{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"},{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"}]},{"lv":6,"opts":[{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"},{"id":"efficient","name":"Efficient","thai":"ประหยัด","desc":"SP -50%"},{"id":"reach","name":"Reach","thai":"ระยะยาว","desc":"ระยะร่าย +2 ช่อง"}]},{"lv":10,"opts":[{"id":"master","name":"Master","thai":"ชำนาญ","desc":"คูลดาวน์ -50%, เวลาร่าย -50%"},{"id":"free","name":"Effortless","thai":"ไร้แรง","desc":"SP -70%"},{"id":"long-reach","name":"Long Reach","thai":"ระยะไกล","desc":"ระยะร่าย +3 ช่อง"}]}]},
    {"id":"hiding","name":"Vanish","thai":"ซ่อนตัว","maxLevel":10,"kind":"toggle","req":"ขโมย Lv.5","prereq":[{"skill":"steal","level":5}],"desc":"ซ่อนตัวใต้ดิน มอนเลิกไล่ แต่เคลื่อนที่ไม่ได้และเสีย SP ต่อเนื่อง"},
    {"id":"back-slide","name":"Backflip","thai":"ถอยฉาก","maxLevel":1,"kind":"active","desc":"กระโดดถอยหลัง 5 ช่อง ทิศตรงข้ามกับที่ตัวละครหันอยู่ (แบบ RO) ตัวละครยังหันหน้าเดิม ชนกำแพงแล้วหยุด","facets":[{"lv":1,"opts":[{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"},{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"}]},{"lv":1,"opts":[{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"},{"id":"efficient","name":"Efficient","thai":"ประหยัด","desc":"SP -50%"},{"id":"reach","name":"Reach","thai":"ระยะยาว","desc":"ระยะร่าย +2 ช่อง"}]},{"lv":1,"opts":[{"id":"master","name":"Master","thai":"ชำนาญ","desc":"คูลดาวน์ -50%, เวลาร่าย -50%"},{"id":"free","name":"Effortless","thai":"ไร้แรง","desc":"SP -70%"},{"id":"long-reach","name":"Long Reach","thai":"ระยะไกล","desc":"ระยะร่าย +3 ช่อง"}]}]},
    {"id":"envenom","name":"Venom Strike","thai":"จู่โจมพิษ","maxLevel":10,"kind":"active","desc":"โจมตีด้วยพิษ มีโอกาสทำให้เป้าหมายติดพิษ","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"venom","name":"Venom","thai":"พิษร้าย","desc":"โอกาส 12% ติดพิษ 4 วิ"}]},{"lv":12,"opts":[{"id":"cleave","name":"Cleave","thai":"ฟันกวาด","desc":"ศัตรูรอบเป้าในระยะ 1 ช่อง โดน 82% ของดาเมจสกิลด้วย (ใช้กับสกิลเป้าเดียว)"},{"id":"executioner","name":"Executioner","thai":"เพชฌฆาต","desc":"ดาเมจ +566% กับเป้าที่เลือดต่ำกว่า 30%"},{"id":"lingering","name":"Lingering","thai":"สถานะยืดเยื้อ","desc":"เวลาสถานะที่สกิลทำ +56%"}]},{"lv":15,"opts":[{"id":"overload","name":"Overload","thai":"ทุ่มสุดตัว","desc":"ดาเมจ +60% แต่คูลดาวน์ +50%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"overkill","name":"Overkill","thai":"ดาเมจล้น","desc":"ดาเมจที่เกินตอนฆ่า 167% ไหลไปศัตรูใกล้สุดใน 5 ช่อง"}]}]}
  ], "dragon-knight": [
    {"id":"dragon-breath","name":"Wyrmfire","thai":"ลมหายใจมังกร","maxLevel":10,"kind":"active","desc":"อัญเชิญมังกรเพลิงจากวงเวทย์ด้านหลัง พ่นไฟเป็นรูปกรวยใส่ศัตรูทุกตัวด้านหน้า โดน 5 ครั้ง","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"ignite","name":"Ignite","thai":"เพลิงลาม","desc":"ศัตรูที่โดนติดไฟ เผาไหม้ 30% ของดาเมจต่อวิ 3 วิ"}]},{"lv":12,"opts":[{"id":"executioner","name":"Executioner","thai":"เพชฌฆาต","desc":"ดาเมจ +566% กับเป้าที่เลือดต่ำกว่า 30%"},{"id":"concussive","name":"Concussive","thai":"แรงกระแทก","desc":"ศัตรูที่โดนช้าลง 28% 3 วิ"},{"id":"chain","name":"Chain","thai":"ลูกโซ่","desc":"เด้งต่อไปยังศัตรูตัวที่ใกล้ที่สุดในระยะ 4 ช่อง ทีละตัว 2-3 ตัว แต่ละตัวโดน 66% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"}]},{"lv":15,"opts":[{"id":"one-strike","name":"One Strike","thai":"รวมพลัง","desc":"ทุกครั้งรวมเป็นครั้งเดียว แรงเท่ารวมกัน ดาเมจ +10%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"epicenter","name":"Epicenter","thai":"จุดศูนย์กลาง","desc":"ศัตรูกลางวง 1 ช่องรับดาเมจ +217%"}]}]}
  ], "wizard": [
    {"id":"safety-wall","name":"Aegis Barrier","thai":"กำแพงนิรภัย","maxLevel":10,"kind":"active","desc":"วางวงเวทบนพื้น ใครยืนในวงไม่โดนดาเมจกายภาพ (เวทยังโดน) อยู่ 8 วินาที +3 ต่อเลเวล · กันได้ (เลเวล+1) ครั้งแล้วแตก (Lv.10: 11 ครั้ง)","facets":[{"lv":3,"opts":[{"id":"sturdy","name":"Sturdy","thai":"แข็งแรง","desc":"กันได้เพิ่ม 3 ครั้ง"},{"id":"lasting","name":"Lasting","thai":"ยืนนาน","desc":"กำแพงอยู่นานขึ้น 20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"}]},{"lv":6,"opts":[{"id":"wide","name":"Wide","thai":"แผ่กว้าง","desc":"พื้นที่ +1 ช่อง"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -40%, คูลดาวน์ -30%"},{"id":"enduring","name":"Enduring","thai":"ทนทาน","desc":"กันได้เพิ่ม 2 ครั้ง และอยู่นานขึ้น 30%"}]},{"lv":10,"opts":[{"id":"bastion","name":"Bastion","thai":"ป้อมปราการ","desc":"กันได้เพิ่ม 8 ครั้ง แต่คูลดาวน์ +30%"},{"id":"sanctum","name":"Sanctum","thai":"เขตศักดิ์สิทธิ์","desc":"พื้นที่ +2 ช่อง แต่กันได้น้อยลง 2 ครั้ง"},{"id":"instant","name":"Instant Wall","thai":"กำแพงฉับพลัน","desc":"เวลาร่าย -70%, คูลดาวน์ -40%"}]}]},
    {"id":"jupitel-thunder","name":"Thunder Orb","thai":"ลูกบอลสายฟ้า","maxLevel":10,"kind":"active","req":"ศรสายฟ้า Lv.5","prereq":[{"skill":"lightning-bolt","level":5}],"desc":"ยิงลูกบอลสายฟ้าที่ระเบิดหลายครั้ง ธาตุลม ผลักเป้าหมายกระเด็นออกไป","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"}]},{"lv":12,"opts":[{"id":"arc","name":"Arc","thai":"สายฟ้ากระโดด","desc":"ลูกบอลกระโดดต่อ 3 ตัวในระยะ 4 ช่อง ตัวละ 66%"},{"id":"pierce","name":"Pierce","thai":"ทะลวง","desc":"ทะลุไปโดนศัตรูด้านหลัง 4 ช่อง 101%"},{"id":"shock","name":"Shock","thai":"ช็อต","desc":"โอกาส 11% มึน 1.5 วิ"}]},{"lv":15,"opts":[{"id":"ball-lightning","name":"Ball Lightning","thai":"บอลสายฟ้ายักษ์","desc":"รวมทุกลูกเป็นลูกเดียว แรงเท่าทุกลูกรวมกัน ช็อตศัตรูรอบเป้า 1 ช่อง 92%"},{"id":"twin-orb","name":"Twin Orb","thai":"บอลคู่","desc":"แตก 2 ลูกไปหาศัตรูอื่นใกล้เป้า ลูกละ 112%"},{"id":"plasma-burst","name":"Plasma Burst","thai":"ระเบิดพลาสมา","desc":"ระเบิดรอบเป้า 1 ช่อง 112%"}]}]},
    {"id":"heavens-drive","name":"Earth Rupture","thai":"ธรณีทะลวง","maxLevel":10,"kind":"active","req":"คลื่นจิต Lv.3","prereq":[{"skill":"napalm-beat","level":3}],"desc":"หนามหินพุ่งขึ้นจากพื้นในพื้นที่ที่เลือก ธาตุดิน โดนศัตรูทุกตัวในวง","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"crack","name":"Crack","thai":"ผิวแตก","desc":"เป้าที่โดน DEF -7% 4 วิ"}]},{"lv":12,"opts":[{"id":"wide","name":"Wide","thai":"แผ่กว้าง","desc":"พื้นที่ +1 ช่อง"},{"id":"quake","name":"Quake","thai":"สะเทือน","desc":"ศัตรูที่โดนช้าลง 14% 3 วิ"},{"id":"aftershock","name":"Aftershock","thai":"แผ่นดินไหวซ้ำ","desc":"พื้นสั่นซ้ำหลัง 1 วิ ทุกตัวโดน 189%"}]},{"lv":15,"opts":[{"id":"monolith","name":"Monolith","thai":"เสาหินยักษ์","desc":"หินแหลมทุกแท่งรวมเป็นแท่งยักษ์แท่งเดียว แรงเท่ารวมกัน ศัตรูกลางวง 1 ช่องโดนแรงขึ้น 217%"},{"id":"fault-line","name":"Fault Line","thai":"รอยเลื่อน","desc":"เกิดวงเล็กซ้ำ 2 จุดรอบวง ดาเมจ 114% ของทั้งสกิล"},{"id":"great-quake","name":"Great Quake","thai":"มหาแผ่นดินไหว","desc":"พื้นสั่นซ้ำหลัง 1 วิ 216% และ DEF -14% 4 วิ"}]}]},
    {"id":"quagmire","name":"Sinking Mire","thai":"บึงโคลน","maxLevel":10,"kind":"active","req":"ธรณีทะลวง Lv.1","prereq":[{"skill":"heavens-drive","level":1}],"desc":"เปลี่ยนพื้นเป็นบึงโคลน มอนในวงเดินช้าลง","facets":[{"lv":3,"opts":[{"id":"deep-mud","name":"Deep Mud","thai":"โคลนลึก","desc":"ทำให้ช้าลงแรงขึ้น 10%"},{"id":"wide","name":"Wide","thai":"แผ่กว้าง","desc":"พื้นที่ +1 ช่อง"},{"id":"lasting","name":"Lasting","thai":"ยืนนาน","desc":"โคลนอยู่นานขึ้น 20%"}]},{"lv":6,"opts":[{"id":"exploit","name":"Exploit","thai":"ซ้ำเติม","desc":"มอนที่ติดโคลนรับดาเมจจากทุกคนเพิ่ม 8% (บอสครึ่งหนึ่ง)"},{"id":"contagion","name":"Contagion","thai":"ลามไป","desc":"ความช้าลามไปมอนรอบเป้า 2 ช่อง 55% (สูงสุด 3 ตัว)"},{"id":"sticky","name":"Sticky","thai":"เหนียวหนึบ","desc":"ความช้าอยู่นานขึ้น 12%"}]},{"lv":10,"opts":[{"id":"abyss","name":"Abyss","thai":"หลุมลึก","desc":"ทำให้ช้าลงแรงขึ้น 22% และมอนที่ติดรับดาเมจเพิ่ม 11%"},{"id":"swamp","name":"Great Swamp","thai":"บึงใหญ่","desc":"พื้นที่ +2 ช่อง และอยู่นานขึ้น 38%"},{"id":"plague","name":"Plague Mire","thai":"โคลนระบาด","desc":"ความช้าลามไปมอนรอบเป้า 65% และมอนที่ติดรับดาเมจเพิ่ม 11%"}]}]},
    {"id":"storm-gust","name":"Blizzard Tempest","thai":"พายุหิมะ","maxLevel":10,"kind":"active","req":"ธาราเยือกแข็ง Lv.3, ลูกบอลสายฟ้า Lv.3","prereq":[{"skill":"frost-diver","level":3},{"skill":"jupitel-thunder","level":3}],"desc":"พายุหิมะโหมกระหน่ำในพื้นที่กว้าง ธาตุน้ำ โดน 5 ครั้ง ครั้งที่ 3 มีโอกาสแช่แข็ง (MDEF ของเป้าลดโอกาส) ตัวที่แข็งแล้วไม่โดนพายุลูกเดียวกันซ้ำ","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"chill","name":"Chill","thai":"หนาวเหน็บ","desc":"ศัตรูที่โดนช้าลง 9% 3 วิ"}]},{"lv":12,"opts":[{"id":"shatter","name":"Shatter","thai":"แตกละเอียด","desc":"ศัตรูที่แข็งอยู่โดนแรงขึ้น 55% แล้วหลุดแข็ง"},{"id":"long-storm","name":"Lingering Storm","thai":"พายุยาว","desc":"พายุอยู่นานขึ้น 2 คลื่น แต่ละคลื่น -10%"},{"id":"wide","name":"Wide Storm","thai":"พายุกว้าง","desc":"พื้นที่ +1.5 ช่อง"}]},{"lv":15,"opts":[{"id":"absolute-zero","name":"Absolute Zero","thai":"ศูนย์สัมบูรณ์","desc":"วงเล็กลง 2 ช่อง ดาเมจ +30% ศัตรูที่แข็งอยู่โดนแรงขึ้น 65%"},{"id":"blizzard-vortex","name":"Blizzard Vortex","thai":"วังวนหิมะ","desc":"ดูดศัตรูเข้ากลางวง 1 ช่อง และแข็งนานขึ้น 35%"},{"id":"ice-cascade","name":"Ice Cascade","thai":"พายุซ้อน","desc":"เกิดวงเล็กซ้ำ 2 จุดรอบวง ดาเมจ 114% ของทั้งสกิล"}]}]},
    {"id":"meteor-storm","name":"Meteor Rain","thai":"ฝนอุกกาบาต","maxLevel":10,"kind":"active","req":"ศรเพลิง Lv.5, ธรณีทะลวง Lv.3","prereq":[{"skill":"fire-bolt","level":5},{"skill":"heavens-drive","level":3}],"desc":"เรียกอุกกาบาตเพลิงถล่มพื้นที่ ธาตุไฟ ตกลงมาทีละลูกช้าๆ มีโอกาสทำให้มึนงง","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"scorch","name":"Scorch","thai":"ไฟลุก","desc":"ศัตรูที่โดนติดไฟ เผา 30% ของดาเมจต่อวิ 3 วิ"}]},{"lv":12,"opts":[{"id":"impact","name":"Impact","thai":"แรงกระแทก","desc":"โอกาส 11% มึน 1.5 วิ"},{"id":"wide","name":"Wide Rain","thai":"ฝนกว้าง","desc":"พื้นที่ +1.5 ช่อง"},{"id":"focused","name":"Focused Rain","thai":"ตกรวมจุด","desc":"ศัตรูกลางวง 1 ช่องโดนแรงขึ้น 184%"}]},{"lv":15,"opts":[{"id":"cataclysm","name":"Cataclysm","thai":"มหาวินาศ","desc":"อุกกาบาตยักษ์ลูกเดียวตกกลางวง แรงเท่าทุกลูกรวมกัน กลางวง 1 ช่องโดนแรงขึ้น 217%"},{"id":"starfall","name":"Starfall","thai":"ดาวตก","desc":"ดาวตกเพิ่ม 6 ลูก วงกว้าง +1 ช่อง แต่ละลูก -45%"},{"id":"meteor-cascade","name":"Meteor Cascade","thai":"ฝนซ้อน","desc":"เกิดวงเล็กซ้ำ 2 จุดรอบวง ดาเมจ 114% ของทั้งสกิล"}]}]},
    {"id":"lord-of-vermilion","name":"Wrath of Thunder","thai":"อสนีบาตพิโรธ","maxLevel":10,"kind":"active","req":"ลูกบอลสายฟ้า Lv.5","prereq":[{"skill":"jupitel-thunder","level":5}],"desc":"สายฟ้านับร้อยฟาดลงพื้นที่กว้าง ธาตุลม โดนหลายครั้ง","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"static-field","name":"Static Field","thai":"สนามไฟฟ้า","desc":"ศัตรูที่โดนช้าลง 9% 3 วิ"}]},{"lv":12,"opts":[{"id":"paralyze","name":"Paralyze","thai":"ชาอัมพาต","desc":"โอกาส 11% มึน 1 วิ"},{"id":"overcharge","name":"Overcharge","thai":"ประจุเกิน","desc":"เพิ่ม 1 คลื่น แต่คูลดาวน์ +15%"},{"id":"wide","name":"Wide Storm","thai":"พายุกว้าง","desc":"พื้นที่ +1.5 ช่อง"}]},{"lv":15,"opts":[{"id":"judgment","name":"Judgment Pillar","thai":"เสาพิพากษา","desc":"ทุกคลื่นรวมเป็นสายฟ้าครั้งเดียว แรงเท่ารวมกัน ศัตรูกลางวง 1 ช่องโดนแรงขึ้น 217%"},{"id":"storm-field","name":"Storm Field","thai":"ทุ่งพายุ","desc":"สายฟ้าเพิ่ม 4 คลื่น แต่ละคลื่น -35%"},{"id":"thunder-god","name":"Thunder God","thai":"เทพอัสนี","desc":"ฟ้าผ่าต่อจากตัวแรก 3 ตัวในระยะ 5 ช่อง ตัวละ 305%"}]}]},
    {"id":"arcane-amplify","name":"Arcane Amplify","thai":"ขยายพลังเวท","maxLevel":10,"kind":"active","desc":"รวบรวมพลังเวทให้แรงขึ้น MATK +3% ต่อเลเวล นาน 60 วิ (คูลดาวน์ 90 วิ)","facetsPending":true},
    {"id":"mana-shield","name":"Mana Shield","thai":"โล่มานา","maxLevel":10,"kind":"active","desc":"โล่มานาห่อตัว ลดดาเมจที่โดน 3% ต่อเลเวล นาน 300 วิ รับได้ 2 ครั้งต่อเลเวลแล้วโล่แตก ดาเมจที่โล่รับไว้กิน SP เท่ากัน (รับ 100 เสีย SP 100) SP..."}
  ], "sage": [
    {"id":"advanced-book","name":"Tome Mastery","thai":"ชำนาญหนังสือ","maxLevel":10,"kind":"passive","desc":"ชำนาญการใช้หนังสือ: เพิ่มพลังโจมตีและความเร็วโจมตีเมื่อถือหนังสือ · เดินขณะร่ายได้ (ความเร็ว 10% ต่อเลเวล, Lv.10 เต็มความเร็ว) และโจมตีปกติร..."},
    {"id":"dragonology","name":"Dragon Lore","thai":"ปราชญ์มังกร","maxLevel":5,"kind":"passive","desc":"ศึกษาศาสตร์แห่งมังกร: MATK และ DEF +4% ต่อเลเวล (Lv.5 +20%), INT +1/+1/+2/+2/+3"},
    {"id":"earth-spike","name":"Stone Spikes","thai":"หนามปฐพี","maxLevel":10,"kind":"active","desc":"หนามหินแทงขึ้นใต้เป้าหมายตามจำนวนเลเวลสกิล ธาตุดิน","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"tremor","name":"Tremor","thai":"ธรณีสั่น","desc":"เป้าที่โดน DEF -7% 4 วิ"}]},{"lv":12,"opts":[{"id":"fork","name":"Fork","thai":"แยกทาง","desc":"ยิงเพิ่ม 2 ลูกไปหาศัตรูตัวอื่นที่อยู่ภายใน 3 ช่องรอบเป้า แต่ละลูกโดน 101% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"},{"id":"piercing","name":"Piercing","thai":"ทะลวง","desc":"ทะลุเป้าไปโดนศัตรูทุกตัวด้านหลังในแนวยาว 6 ช่อง กว้าง 2 ช่อง แต่ละตัวโดน 116% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"},{"id":"executioner","name":"Executioner","thai":"เพชฌฆาต","desc":"ดาเมจ +566% กับเป้าที่เลือดต่ำกว่า 30%"}]},{"lv":15,"opts":[{"id":"one-strike","name":"One Strike","thai":"รวมพลัง","desc":"ทุกครั้งรวมเป็นครั้งเดียว แรงเท่ารวมกัน ดาเมจ +10%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"overkill","name":"Overkill","thai":"ดาเมจล้น","desc":"ดาเมจที่เกินตอนฆ่า 167% ไหลไปศัตรูใกล้สุดใน 5 ช่อง"}]}]},
    {"id":"endow-blaze","name":"Flame Enchant","thai":"อาวุธเพลิง","maxLevel":5,"kind":"active","req":"ชำนาญหนังสือ Lv.2, ศรเพลิง Lv.1","prereq":[{"skill":"advanced-book","level":2},{"skill":"fire-bolt","level":1}],"desc":"ใส่พลังธาตุไฟให้อาวุธของตัวเองหรือเพื่อนในปาร์ตี้ การโจมตีปกติกลายเป็นธาตุไฟ (มีได้ทีละธาตุ)"},
    {"id":"endow-tsunami","name":"Tide Enchant","thai":"อาวุธวารี","maxLevel":5,"kind":"active","req":"ชำนาญหนังสือ Lv.2, ศรน้ำแข็ง Lv.1","prereq":[{"skill":"advanced-book","level":2},{"skill":"cold-bolt","level":1}],"desc":"ใส่พลังธาตุน้ำให้อาวุธของตัวเองหรือเพื่อนในปาร์ตี้ การโจมตีปกติกลายเป็นธาตุน้ำ (มีได้ทีละธาตุ)"},
    {"id":"endow-tornado","name":"Gale Enchant","thai":"อาวุธวายุ","maxLevel":5,"kind":"active","req":"ชำนาญหนังสือ Lv.2, ศรสายฟ้า Lv.1","prereq":[{"skill":"advanced-book","level":2},{"skill":"lightning-bolt","level":1}],"desc":"ใส่พลังธาตุลมให้อาวุธของตัวเองหรือเพื่อนในปาร์ตี้ การโจมตีปกติกลายเป็นธาตุลม (มีได้ทีละธาตุ)"},
    {"id":"endow-quake","name":"Stone Enchant","thai":"อาวุธปฐพี","maxLevel":5,"kind":"active","req":"ชำนาญหนังสือ Lv.2, หนามปฐพี Lv.1","prereq":[{"skill":"advanced-book","level":2},{"skill":"earth-spike","level":1}],"desc":"ใส่พลังธาตุดินให้อาวุธของตัวเองหรือเพื่อนในปาร์ตี้ การโจมตีปกติกลายเป็นธาตุดิน (มีได้ทีละธาตุ)"},
    {"id":"auto-spell","name":"Spell Echo","thai":"เวทอัตโนมัติ","maxLevel":10,"kind":"active","req":"ชำนาญหนังสือ Lv.3","prereq":[{"skill":"advanced-book","level":3}],"desc":"ช่วงเวลาหนึ่ง การโจมตีปกติที่โดนมีโอกาสร่าย Flame/Frost/Thunder Lance หรือ Stone Spikes ที่เรียนแล้วโดยอัตโนมัติ ที่เลเวลของสกิลนั้นในตัวละค..."},
    {"id":"create-converter","name":"Craft Element Scroll","thai":"สร้างใบธาตุ","maxLevel":1,"kind":"active","req":"ชำนาญหนังสือ Lv.5","prereq":[{"skill":"advanced-book","level":5}],"desc":"สร้างใบธาตุ (ไฟ น้ำ ลม ดิน) จาก Blank Scroll 1 แผ่น + หินธาตุ 2 ก้อนต่อใบ (Red Blood, Crystal Blue, Wind of Verdure, Green Live ดรอปจากมอนธา...","facets":[{"lv":1,"opts":[{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"},{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"}]},{"lv":1,"opts":[{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"},{"id":"efficient","name":"Efficient","thai":"ประหยัด","desc":"SP -50%"},{"id":"reach","name":"Reach","thai":"ระยะยาว","desc":"ระยะร่าย +2 ช่อง"}]},{"lv":1,"opts":[{"id":"master","name":"Master","thai":"ชำนาญ","desc":"คูลดาวน์ -50%, เวลาร่าย -50%"},{"id":"free","name":"Effortless","thai":"ไร้แรง","desc":"SP -70%"},{"id":"long-reach","name":"Long Reach","thai":"ระยะไกล","desc":"ระยะร่าย +3 ช่อง"}]}]},
    {"id":"land-protector","name":"Sealed Ground","thai":"ผนึกปฐพี","maxLevel":1,"kind":"active","desc":"วางผนึกบนพื้น 11 ช่อง (รัศมี 5.5) อยู่ 120 วินาที ผู้เล่นที่ยืนในวง: ไม่โดนเวทของมอนและเวทใน PvP · สกิลเวทของบอสเบาลง 30% · ไม่ติดมึน/แช่แข็...","facets":[{"lv":1,"opts":[{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"},{"id":"enduring-ground","name":"Enduring Ground","thai":"เขตยืนยง","desc":"โซนของสกิลนี้อยู่นานขึ้น 20%"}]},{"lv":1,"opts":[{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"},{"id":"wide","name":"Wide","thai":"แผ่กว้าง","desc":"พื้นที่ +1 ช่อง"},{"id":"efficient","name":"Efficient","thai":"ประหยัด","desc":"SP -50%"}]},{"lv":1,"opts":[{"id":"master","name":"Master","thai":"ชำนาญ","desc":"คูลดาวน์ -50%, เวลาร่าย -50%"},{"id":"free","name":"Effortless","thai":"ไร้แรง","desc":"SP -70%"},{"id":"long-reach","name":"Long Reach","thai":"ระยะไกล","desc":"ระยะร่าย +3 ช่อง"}]}]},
    {"id":"flame-field","name":"Flame Field","thai":"ทุ่งเพลิง","maxLevel":5,"kind":"active","req":"อาวุธเพลิง Lv.2","prereq":[{"skill":"endow-blaze","level":2}],"desc":"วางพื้นธาตุไฟรอบตัว (รัศมี 3.5 ช่อง) ที่เดินตามผู้ร่าย ตัวเองและเพื่อนในปาร์ตี้ที่ยืนในวงทำดาเมจธาตุไฟแรงขึ้น 4% ต่อเลเวล (Lv.5 = 20%) ทั้งก...","facets":[{"lv":1,"opts":[{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"},{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"}]},{"lv":3,"opts":[{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"},{"id":"wide","name":"Wide","thai":"แผ่กว้าง","desc":"พื้นที่ +1 ช่อง"},{"id":"efficient","name":"Efficient","thai":"ประหยัด","desc":"SP -50%"}]},{"lv":5,"opts":[{"id":"master","name":"Master","thai":"ชำนาญ","desc":"คูลดาวน์ -50%, เวลาร่าย -50%"},{"id":"free","name":"Effortless","thai":"ไร้แรง","desc":"SP -70%"},{"id":"long-reach","name":"Long Reach","thai":"ระยะไกล","desc":"ระยะร่าย +3 ช่อง"}]}]},
    {"id":"tide-field","name":"Tide Field","thai":"ทุ่งวารี","maxLevel":5,"kind":"active","req":"อาวุธวารี Lv.2","prereq":[{"skill":"endow-tsunami","level":2}],"desc":"วางพื้นธาตุน้ำรอบตัว (รัศมี 3.5 ช่อง) ที่เดินตามผู้ร่าย ตัวเองและเพื่อนในปาร์ตี้ที่ยืนในวงทำดาเมจธาตุน้ำแรงขึ้น 4% ต่อเลเวล (Lv.5 = 20%) ทั้...","facets":[{"lv":1,"opts":[{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"},{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"}]},{"lv":3,"opts":[{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"},{"id":"wide","name":"Wide","thai":"แผ่กว้าง","desc":"พื้นที่ +1 ช่อง"},{"id":"efficient","name":"Efficient","thai":"ประหยัด","desc":"SP -50%"}]},{"lv":5,"opts":[{"id":"master","name":"Master","thai":"ชำนาญ","desc":"คูลดาวน์ -50%, เวลาร่าย -50%"},{"id":"free","name":"Effortless","thai":"ไร้แรง","desc":"SP -70%"},{"id":"long-reach","name":"Long Reach","thai":"ระยะไกล","desc":"ระยะร่าย +3 ช่อง"}]}]},
    {"id":"stone-field","name":"Stone Field","thai":"ทุ่งศิลา","maxLevel":5,"kind":"active","req":"อาวุธปฐพี Lv.2","prereq":[{"skill":"endow-quake","level":2}],"desc":"วางพื้นธาตุดินรอบตัว (รัศมี 3.5 ช่อง) ที่เดินตามผู้ร่าย ตัวเองและเพื่อนในปาร์ตี้ที่ยืนในวงทำดาเมจธาตุดินแรงขึ้น 4% ต่อเลเวล (Lv.5 = 20%) ทั้...","facets":[{"lv":1,"opts":[{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"},{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"}]},{"lv":3,"opts":[{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"},{"id":"wide","name":"Wide","thai":"แผ่กว้าง","desc":"พื้นที่ +1 ช่อง"},{"id":"efficient","name":"Efficient","thai":"ประหยัด","desc":"SP -50%"}]},{"lv":5,"opts":[{"id":"master","name":"Master","thai":"ชำนาญ","desc":"คูลดาวน์ -50%, เวลาร่าย -50%"},{"id":"free","name":"Effortless","thai":"ไร้แรง","desc":"SP -70%"},{"id":"long-reach","name":"Long Reach","thai":"ระยะไกล","desc":"ระยะร่าย +3 ช่อง"}]}]},
    {"id":"gale-field","name":"Gale Field","thai":"ทุ่งวายุ","maxLevel":5,"kind":"active","req":"อาวุธวายุ Lv.2","prereq":[{"skill":"endow-tornado","level":2}],"desc":"วางพื้นธาตุลมรอบตัว (รัศมี 3.5 ช่อง) ที่เดินตามผู้ร่าย ตัวเองและเพื่อนในปาร์ตี้ที่ยืนในวงทำดาเมจธาตุลมแรงขึ้น 4% ต่อเลเวล (Lv.5 = 20%) ทั้งก...","facets":[{"lv":1,"opts":[{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"},{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"}]},{"lv":3,"opts":[{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"},{"id":"wide","name":"Wide","thai":"แผ่กว้าง","desc":"พื้นที่ +1 ช่อง"},{"id":"efficient","name":"Efficient","thai":"ประหยัด","desc":"SP -50%"}]},{"lv":5,"opts":[{"id":"master","name":"Master","thai":"ชำนาญ","desc":"คูลดาวน์ -50%, เวลาร่าย -50%"},{"id":"free","name":"Effortless","thai":"ไร้แรง","desc":"SP -70%"},{"id":"long-reach","name":"Long Reach","thai":"ระยะไกล","desc":"ระยะร่าย +3 ช่อง"}]}]},
    {"id":"twin-bolt","name":"Twin Bolt","thai":"เวทคู่","maxLevel":5,"kind":"passive","req":"ชำนาญหนังสือ Lv.3","prereq":[{"skill":"advanced-book","level":3}],"desc":"สกิลโบลต์ (Fire Bolt, Cold Bolt, Lightning Bolt, Stone Spikes) มีโอกาสออกซ้ำอีกชุด: ร่ายเอง 6% ต่อเลเวล (Lv.5 = 30%) · ออกจาก Auto Spell 1% ..."}
  ], "knight": [
    {"id":"two-hand-sword-mastery","name":"Greatsword Mastery","thai":"ชำนาญดาบสองมือ","maxLevel":10,"kind":"passive","desc":"เพิ่มพลังโจมตีเมื่อใช้ดาบสองมือ"},
    {"id":"spear-dynamo","name":"Spear Fervor","thai":"พลังหอก","maxLevel":10,"kind":"passive","req":"ชำนาญหอก Lv.1","prereq":[{"skill":"spear-mastery","level":1}],"desc":"ติดตัว: ความเสียหายระยะประชิดเพิ่มขึ้นเมื่อถือหอก (มือเดียวหรือสองมือ) คู่กับ Greatsword Haste ของสายดาบ แต่เพิ่มแรงแทนความเร็ว"},
    {"id":"pierce","name":"Piercing Lunge","thai":"แทงทะลวง","maxLevel":10,"kind":"active","req":"ฟันกระแทก Lv.5","prereq":[{"skill":"bash","level":5}],"desc":"แทงเป้าหมายต่อเนื่องหลายครั้ง จำนวนครั้งเพิ่มตามเลเวล · มอนสเตอร์ขนาดใหญ่โดนเป็นสองเท่า (Lv.10: 6 ครั้ง)","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"crushing-blow","name":"Crushing Blow","thai":"ทุบสะท้าน","desc":"โอกาส 14% มึน 1.5 วิ"}]},{"lv":12,"opts":[{"id":"executioner","name":"Executioner","thai":"เพชฌฆาต","desc":"ดาเมจ +566% กับเป้าที่เลือดต่ำกว่า 30%"},{"id":"cleave","name":"Cleave","thai":"ฟันกวาด","desc":"ศัตรูรอบเป้าในระยะ 1 ช่อง โดน 82% ของดาเมจสกิลด้วย (ใช้กับสกิลเป้าเดียว)"},{"id":"overheat","name":"Overheat","thai":"ทุ่มแรง","desc":"ดาเมจ +35% แต่คูลดาวน์ +40%"}]},{"lv":15,"opts":[{"id":"one-strike","name":"One Strike","thai":"รวมพลัง","desc":"ทุกครั้งรวมเป็นครั้งเดียว แรงเท่ารวมกัน ดาเมจ +10%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"detonate","name":"Detonate","thai":"ระเบิดศพ","desc":"ศัตรูที่ตายจากสกิลนี้ระเบิด ทำดาเมจ 90% ของ HP สูงสุดของตัวที่ตาย ใส่ศัตรูรอบ 5 ช่อง (ไม่เกิน 3 เท่าของดาเมจที่ฆ่า) ตัวที่ตายจากแรงระเบิดจะระเบิดต่ออีก 1 ทอด"}]}]},
    {"id":"bowling-bash","name":"Cleaving Storm","thai":"ฟันกวาดกระแทก","maxLevel":10,"kind":"active","req":"ฟันกระแทก Lv.5, ระเบิดเพลิง Lv.3","prereq":[{"skill":"bash","level":5},{"skill":"magnum-break","level":3}],"desc":"เลือกจุดบนพื้น ฟาดศัตรูทุกตัวในรัศมี 3 ช่องรอบจุดนั้นสองครั้ง แล้วผลักกระเด็นออกจากจุดกลาง · ยิ่งโดนหลายตัวยิ่งแรง: ทุกตัวที่เพิ่มจากตัวแรก ...","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"concussive","name":"Concussive","thai":"แรงกระแทก","desc":"ศัตรูที่โดนช้าลง 18% 3 วิ"}]},{"lv":12,"opts":[{"id":"aftershock","name":"Aftershock","thai":"แรงสั่นสะเทือน","desc":"พื้นสั่นซ้ำหลัง 1 วิ ทุกตัวในพื้นที่โดน 189% ของดาเมจสกิล"},{"id":"vortex","name":"Vortex","thai":"วังวน","desc":"ดูดศัตรูในพื้นที่เข้าหากลางวง 1.5 ช่องก่อนโดน"},{"id":"epicenter","name":"Epicenter","thai":"จุดศูนย์กลาง","desc":"ศัตรูกลางวง 1 ช่องรับดาเมจ +184%"}]},{"lv":15,"opts":[{"id":"one-strike","name":"One Strike","thai":"รวมพลัง","desc":"ทุกครั้งรวมเป็นครั้งเดียว แรงเท่ารวมกัน ดาเมจ +10%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"overkill","name":"Overkill","thai":"ดาเมจล้น","desc":"ดาเมจที่เกินตอนฆ่า 167% ไหลไปศัตรูใกล้สุดใน 5 ช่อง"}]}]},
    {"id":"brandish-spear","name":"Spear Sweep","thai":"กวาดใบมีด","maxLevel":10,"kind":"active","req":"แทงทะลวง Lv.3","prereq":[{"skill":"pierce","level":3}],"desc":"เลือกจุดบนพื้นในระยะ 4 ช่อง กวาดอาวุธโดนศัตรูทุกตัวในรัศมี 3 ช่องรอบจุดนั้น · ขี่ Peco อยู่: แรงขึ้น 50% และรัศมีเป็น 5 ช่อง ถ้าถือหอกสองมือ...","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"concussive","name":"Concussive","thai":"แรงกระแทก","desc":"ศัตรูที่โดนช้าลง 18% 3 วิ"}]},{"lv":12,"opts":[{"id":"vortex","name":"Vortex","thai":"วังวน","desc":"ดูดศัตรูในพื้นที่เข้าหากลางวง 1.5 ช่องก่อนโดน"},{"id":"epicenter","name":"Epicenter","thai":"จุดศูนย์กลาง","desc":"ศัตรูกลางวง 1 ช่องรับดาเมจ +184%"},{"id":"aftershock","name":"Aftershock","thai":"แรงสั่นสะเทือน","desc":"พื้นสั่นซ้ำหลัง 1 วิ ทุกตัวในพื้นที่โดน 189% ของดาเมจสกิล"}]},{"lv":15,"opts":[{"id":"overload","name":"Overload","thai":"ทุ่มสุดตัว","desc":"ดาเมจ +60% แต่คูลดาวน์ +50%"},{"id":"wider","name":"Vast","thai":"กว้างไกล","desc":"พื้นที่ +2 ช่อง แต่ดาเมจ -15%"},{"id":"overkill","name":"Overkill","thai":"ดาเมจล้น","desc":"ดาเมจที่เกินตอนฆ่า 167% ไหลไปศัตรูใกล้สุดใน 5 ช่อง"}]}]},
    {"id":"two-hand-quicken","name":"Greatsword Haste","thai":"เร่งดาบสองมือ","maxLevel":10,"kind":"active","req":"ชำนาญดาบสองมือ Lv.1","prereq":[{"skill":"two-hand-sword-mastery","level":1}],"desc":"เร่งความเร็วโจมตีและคริติคอลชั่วคราว","facetsPending":true},
    {"id":"parry","name":"Riposte Guard","thai":"ปัดป้อง","maxLevel":10,"kind":"active","req":"ยั่วยุ Lv.5, ชำนาญดาบสองมือ Lv.10, เร่งดาบสองมือ Lv.3","prereq":[{"skill":"provoke","level":5},{"skill":"two-hand-sword-mastery","level":10},{"skill":"two-hand-quicken","level":3}],"desc":"ตั้งท่าปัดป้องด้วยดาบสองมือ ช่วงบัพมีโอกาสปัดการโจมตีทางกายภาพทิ้ง (ไม่โดนดาเมจ) ต้องถือดาบสองมือ"},
    {"id":"charge-attack","name":"Valiant Charge","thai":"พุ่งโจมตี","maxLevel":1,"kind":"active","desc":"พุ่งเข้าหาศัตรูจากระยะไกลแล้วฟาดทันที ยิ่งพุ่งไกลยิ่งแรง แบบ RO: ทุก 2 ช่องที่พุ่ง +100% (100% ถึง 500% ที่ระยะ 9 ช่อง) เลเวลเดียว ไม่ต้องมี...","facets":[{"lv":1,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"crushing-blow","name":"Crushing Blow","thai":"ทุบสะท้าน","desc":"โอกาส 14% มึน 1.5 วิ"}]},{"lv":1,"opts":[{"id":"executioner","name":"Executioner","thai":"เพชฌฆาต","desc":"ดาเมจ +566% กับเป้าที่เลือดต่ำกว่า 30%"},{"id":"cleave","name":"Cleave","thai":"ฟันกวาด","desc":"ศัตรูรอบเป้าในระยะ 1 ช่อง โดน 82% ของดาเมจสกิลด้วย (ใช้กับสกิลเป้าเดียว)"},{"id":"overheat","name":"Overheat","thai":"ทุ่มแรง","desc":"ดาเมจ +35% แต่คูลดาวน์ +40%"}]},{"lv":1,"opts":[{"id":"overload","name":"Overload","thai":"ทุ่มสุดตัว","desc":"ดาเมจ +60% แต่คูลดาวน์ +50%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"overkill","name":"Overkill","thai":"ดาเมจล้น","desc":"ดาเมจที่เกินตอนฆ่า 167% ไหลไปศัตรูใกล้สุดใน 5 ช่อง"}]}]},
    {"id":"spear-mastery","name":"Lance Mastery","thai":"ชำนาญหอก","maxLevel":10,"kind":"passive","desc":"เพิ่มพลังโจมตีเมื่อใช้หอก"},
    {"id":"peco-peco-ride","name":"Peco Rider","thai":"ขี่เปโก้เปโก้","maxLevel":1,"kind":"passive","req":"จิตมั่นคง Lv.1","prereq":[{"skill":"endure","level":1}],"desc":"ขี่ Peco Peco ได้ (เช่าที่ Healer Mira 2,500 z) ขี่แล้วเดินเร็วขึ้น 25% แต่ตีช้าลง 25%"},
    {"id":"peco-peco-master","name":"Cavalry Mastery","thai":"ชำนาญการขี่","maxLevel":5,"kind":"passive","req":"ขี่เปโก้เปโก้ Lv.1","prereq":[{"skill":"peco-peco-ride","level":1}],"desc":"ขี่ Peco Peco แล้วตีช้าลงน้อยลง 5% ต่อเลเวล (Lv5 ไม่ช้าลงเลย)"}
  ], "crusader": [
    {"id":"faith","name":"Devotion","thai":"ศรัทธา","maxLevel":10,"kind":"passive","desc":"เพิ่ม HP สูงสุดถาวร +200 ต่อเลเวล และ +2% ต่อเลเวล (Lv.10 = +2,000 และ +20%) และต้านธาตุศักดิ์สิทธิ์ +3% ต่อเลเวล (Lv.10 = 30%) · HP ปัจจุบั..."},
    {"id":"holy-cross","name":"Sacred Cross","thai":"กางเขนศักดิ์สิทธิ์","maxLevel":10,"kind":"active","req":"ศรัทธา Lv.3","prereq":[{"skill":"faith","level":3}],"desc":"ฟันเป็นรูปกางเขนสองครั้ง ธาตุศักดิ์สิทธิ์ อันเดดและปีศาจโดนแรงขึ้น 30% · ติดตราศักดิ์สิทธิ์: เป้ารับดาเมจสกิลธาตุศักดิ์สิทธิ์เพิ่ม 25% นาน 6...","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"crushing-blow","name":"Crushing Blow","thai":"ทุบสะท้าน","desc":"โอกาส 14% มึน 1.5 วิ"}]},{"lv":12,"opts":[{"id":"executioner","name":"Executioner","thai":"เพชฌฆาต","desc":"ดาเมจ +566% กับเป้าที่เลือดต่ำกว่า 30%"},{"id":"cleave","name":"Cleave","thai":"ฟันกวาด","desc":"ศัตรูรอบเป้าในระยะ 1 ช่อง โดน 82% ของดาเมจสกิลด้วย (ใช้กับสกิลเป้าเดียว)"},{"id":"overheat","name":"Overheat","thai":"ทุ่มแรง","desc":"ดาเมจ +35% แต่คูลดาวน์ +40%"}]},{"lv":15,"opts":[{"id":"one-strike","name":"One Strike","thai":"รวมพลัง","desc":"ทุกครั้งรวมเป็นครั้งเดียว แรงเท่ารวมกัน ดาเมจ +10%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"overkill","name":"Overkill","thai":"ดาเมจล้น","desc":"ดาเมจที่เกินตอนฆ่า 167% ไหลไปศัตรูใกล้สุดใน 5 ช่อง"}]}]},
    {"id":"grand-cross","name":"Divine Crucible","thai":"กางเขนมหาศักดิ์สิทธิ์","maxLevel":10,"kind":"active","req":"กางเขนศักดิ์สิทธิ์ Lv.5, ศรัทธา Lv.5","prereq":[{"skill":"holy-cross","level":5},{"skill":"faith","level":5}],"desc":"ปลดปล่อยกางเขนแสงสีขาวรอบตัว ธาตุศักดิ์สิทธิ์ (ATK + MATK) โดนศัตรูรอบด้าน 6 ครั้ง","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"sanctify","name":"Sanctify","thai":"ชำระบาป","desc":"ดาเมจกับอันเดดและปีศาจ +9%"}]},{"lv":12,"opts":[{"id":"vortex","name":"Vortex","thai":"วังวน","desc":"ดูดศัตรูในพื้นที่เข้าหากลางวง 1.5 ช่องก่อนโดน"},{"id":"epicenter","name":"Epicenter","thai":"จุดศูนย์กลาง","desc":"ศัตรูกลางวง 1 ช่องรับดาเมจ +184%"},{"id":"spell-cascade","name":"Spell Cascade","thai":"เวทลดหลั่น","desc":"เกิดพื้นที่เล็กซ้ำ 2 จุดครึ่งทางจากกลางวงออกไป ดาเมจ 100% ของทั้งสกิล"}]},{"lv":15,"opts":[{"id":"one-strike","name":"One Strike","thai":"รวมพลัง","desc":"ทุกครั้งรวมเป็นครั้งเดียว แรงเท่ารวมกัน ดาเมจ +10%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"overkill","name":"Overkill","thai":"ดาเมจล้น","desc":"ดาเมจที่เกินตอนฆ่า 167% ไหลไปศัตรูใกล้สุดใน 5 ช่อง"}]}]},
    {"id":"shield-charge","name":"Shield Rush","thai":"พุ่งชนด้วยโล่","maxLevel":10,"kind":"active","req":"ป้องกันอัตโนมัติ Lv.5","prereq":[{"skill":"auto-guard","level":5}],"desc":"พุ่งชนด้วยโล่ ผลักกระเด็นและมีโอกาสทำให้มึนงง","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"crushing-blow","name":"Crushing Blow","thai":"ทุบสะท้าน","desc":"โอกาส 14% มึน 1.5 วิ"}]},{"lv":12,"opts":[{"id":"cleave","name":"Cleave","thai":"ฟันกวาด","desc":"ศัตรูรอบเป้าในระยะ 1 ช่อง โดน 82% ของดาเมจสกิลด้วย (ใช้กับสกิลเป้าเดียว)"},{"id":"executioner","name":"Executioner","thai":"เพชฌฆาต","desc":"ดาเมจ +566% กับเป้าที่เลือดต่ำกว่า 30%"},{"id":"lingering","name":"Lingering","thai":"สถานะยืดเยื้อ","desc":"เวลาสถานะที่สกิลทำ +56%"}]},{"lv":15,"opts":[{"id":"overload","name":"Overload","thai":"ทุ่มสุดตัว","desc":"ดาเมจ +60% แต่คูลดาวน์ +50%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"overkill","name":"Overkill","thai":"ดาเมจล้น","desc":"ดาเมจที่เกินตอนฆ่า 167% ไหลไปศัตรูใกล้สุดใน 5 ช่อง"}]}]},
    {"id":"shield-boomerang","name":"Aegis Throw","thai":"โล่บูมเมอแรง","maxLevel":10,"kind":"active","req":"พุ่งชนด้วยโล่ Lv.3","prereq":[{"skill":"shield-charge","level":3}],"desc":"ขว้างโล่หมุนใส่ศัตรูระยะไกล กระแทก 5 ครั้งแล้วบินกลับมือ แรงขึ้นตามค่าตีบวกโล่ (+5% ต่อขั้น) และ VIT (+0.5% ต่อแต้ม)","facets":[{"lv":3,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"}]},{"lv":6,"opts":[{"id":"chain","name":"Chain","thai":"ลูกโซ่","desc":"เด้งต่อไปยังศัตรูตัวที่ใกล้ที่สุดในระยะ 4 ช่อง ทีละตัว 2-3 ตัว แต่ละตัวโดน 66% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"},{"id":"fork","name":"Fork","thai":"แยกทาง","desc":"ยิงเพิ่ม 2 ลูกไปหาศัตรูตัวอื่นที่อยู่ภายใน 3 ช่องรอบเป้า แต่ละลูกโดน 101% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"},{"id":"piercing","name":"Piercing","thai":"ทะลวง","desc":"ทะลุเป้าไปโดนศัตรูทุกตัวด้านหลังในแนวยาว 6 ช่อง กว้าง 2 ช่อง แต่ละตัวโดน 116% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"}]},{"lv":10,"opts":[{"id":"one-strike","name":"One Strike","thai":"รวมพลัง","desc":"ทุกครั้งรวมเป็นครั้งเดียว แรงเท่ารวมกัน ดาเมจ +10%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"overkill","name":"Overkill","thai":"ดาเมจล้น","desc":"ดาเมจที่เกินตอนฆ่า 167% ไหลไปศัตรูใกล้สุดใน 5 ช่อง"}]}]},
    {"id":"auto-guard","name":"Bulwark","thai":"ป้องกันอัตโนมัติ","maxLevel":10,"kind":"active","desc":"ยกโล่ตั้งรับ มีโอกาสกันการโจมตีได้ทั้งหมดชั่วคราว (4% ต่อเลเวล, Lv.10 = 40%)"},
    {"id":"crusader-heal","name":"Mending Light","thai":"แสงเยียวยา","maxLevel":10,"kind":"active","desc":"ฟื้นฟู HP ให้ตัวเองหรือพันธมิตร ปริมาณขึ้นกับ Base Level และ INT และ INT ทุก 2 แต้มเพิ่มพลังฮีลอีก 1% ใช้กับมอนเผ่า Undead จะทำดาเมจศักดิ์สิ..."},
    {"id":"defender","name":"Defender","thai":"ป้อมปราการ","maxLevel":10,"kind":"active","req":"ป้องกันอัตโนมัติ Lv.3","prereq":[{"skill":"auto-guard","level":3}],"desc":"ตั้งท่าป้อมปราการ ลดดาเมจที่โดน 2.5% ต่อเลเวล (Lv.10 25%) ดาเมจระยะไกลที่โดนลดอีก 5% ต่อเลเวล (Lv.10 50%) แลกกับเดินช้าลง 20% นาน 180 วินาที"},
    {"id":"shield-reflect","name":"Shield Reflect","thai":"โล่สะท้อน","maxLevel":10,"kind":"active","req":"ป้องกันอัตโนมัติ Lv.3","prereq":[{"skill":"auto-guard","level":3}],"desc":"โดนตีประชิดแต่ละครั้ง สะท้อนดาเมจ 0.1% ของ HP สูงสุดของมอนที่ตีต่อเลเวล (Lv.10 1%) บอสโดน 1 ใน 10 ต่อครั้งไม่เกิน 5 เท่าของ HP สูงสุดผู้ใช้ ..."},
    {"id":"guardians-oath","name":"Guardian's Oath","thai":"คำสาบานผู้พิทักษ์","maxLevel":10,"kind":"active","req":"ป้อมปราการ Lv.3","prereq":[{"skill":"defender","level":3}],"desc":"สาบานปกป้องเพื่อนในปาร์ตี้ ทั้งการโจมตีปกติและสกิลของมอนที่ตกกับเพื่อนย้ายมาที่ผู้ใช้แทน (คิดดาเมจใหม่ด้วยพลังป้องกันของผู้ใช้) ปกป้องได้พร้...","facets":[{"lv":3,"opts":[{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"},{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"}]},{"lv":6,"opts":[{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"},{"id":"efficient","name":"Efficient","thai":"ประหยัด","desc":"SP -50%"},{"id":"reach","name":"Reach","thai":"ระยะยาว","desc":"ระยะร่าย +2 ช่อง"}]},{"lv":10,"opts":[{"id":"master","name":"Master","thai":"ชำนาญ","desc":"คูลดาวน์ -50%, เวลาร่าย -50%"},{"id":"free","name":"Effortless","thai":"ไร้แรง","desc":"SP -70%"},{"id":"long-reach","name":"Long Reach","thai":"ระยะไกล","desc":"ระยะร่าย +3 ช่อง"}]}]},
    {"id":"grand-peco-ride","name":"Grand Peco Rider","thai":"ขี่แกรนด์เปโก้","maxLevel":1,"kind":"passive","req":"ศรัทธา Lv.1","prereq":[{"skill":"faith","level":1}],"desc":"ขี่ Peco Peco ได้ (เช่าที่ Healer Mira 2,500 z) ขี่แล้วเดินเร็วขึ้น 25% แต่ตีช้าลง 25% (ผลเหมือน Peco Rider ของ Knight)"},
    {"id":"grand-peco-master","name":"Holy Cavalry","thai":"ชำนาญการขี่แกรนด์เปโก้","maxLevel":5,"kind":"passive","req":"ขี่แกรนด์เปโก้ Lv.1","prereq":[{"skill":"grand-peco-ride","level":1}],"desc":"ขี่ Peco Peco แล้วตีช้าลงน้อยลง 5% ต่อเลเวล (Lv5 ไม่ช้าลงเลย)"}
  ], "hunter": [
    {"id":"falconry-mastery","name":"Falcon Bond","thai":"ฝึกเหยี่ยว","maxLevel":1,"kind":"passive","desc":"ปลดล็อกการเช่าเหยี่ยวที่ Healer Mira (2,500 z) เหยี่ยวบินตามอยู่เหนือไหล่ขวา จำเป็นสำหรับ Falcon Strike, Steel Talons, Falcon Instinct และ F..."},
    {"id":"blitz-beat","name":"Falcon Strike","thai":"เหยี่ยวจู่โจม","maxLevel":10,"kind":"active","req":"ฝึกเหยี่ยว Lv.1, ยิงคู่ Lv.5","prereq":[{"skill":"falconry-mastery","level":1},{"skill":"double-strafe","level":5}],"desc":"สั่งเหยี่ยวพุ่งจิกเป้าหมายหลายครั้ง ต้องมีเหยี่ยว (Falcon Bond) จิกโดนเสมอ ไม่สน DEF และขนาดเป้า ดาเมจต่อการจิก = (แรงตาม DEX และ AGI + ATK ...","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"}]},{"lv":12,"opts":[{"id":"chain","name":"Chain","thai":"ลูกโซ่","desc":"เด้งต่อไปยังศัตรูตัวที่ใกล้ที่สุดในระยะ 4 ช่อง ทีละตัว 2-3 ตัว แต่ละตัวโดน 66% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"},{"id":"fork","name":"Fork","thai":"แยกทาง","desc":"ยิงเพิ่ม 2 ลูกไปหาศัตรูตัวอื่นที่อยู่ภายใน 3 ช่องรอบเป้า แต่ละลูกโดน 101% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"},{"id":"piercing","name":"Piercing","thai":"ทะลวง","desc":"ทะลุเป้าไปโดนศัตรูทุกตัวด้านหลังในแนวยาว 6 ช่อง กว้าง 2 ช่อง แต่ละตัวโดน 116% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"}]},{"lv":15,"opts":[{"id":"one-strike","name":"One Strike","thai":"รวมพลัง","desc":"ทุกครั้งรวมเป็นครั้งเดียว แรงเท่ารวมกัน ดาเมจ +10%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"detonate","name":"Detonate","thai":"ระเบิดศพ","desc":"ศัตรูที่ตายจากสกิลนี้ระเบิด ทำดาเมจ 90% ของ HP สูงสุดของตัวที่ตาย ใส่ศัตรูรอบ 5 ช่อง (ไม่เกิน 3 เท่าของดาเมจที่ฆ่า) ตัวที่ตายจากแรงระเบิดจะระเบิดต่ออีก 1 ทอด"}]}]},
    {"id":"steel-crow","name":"Steel Talons","thai":"เหยี่ยวเหล็ก","maxLevel":10,"kind":"passive","req":"เหยี่ยวจู่โจม Lv.5","prereq":[{"skill":"blitz-beat","level":5}],"desc":"ฝึกกรงเล็บเหยี่ยว ดาเมจเหยี่ยว +6 ต่อเลเวลต่อการจิก 1 ครั้ง (Falcon Strike และ Falcon Instinct)"},
    {"id":"auto-blitz-beat","name":"Falcon Instinct","thai":"เหยี่ยวจู่โจมอัตโนมัติ","maxLevel":5,"kind":"passive","req":"ฝึกเหยี่ยว Lv.1","prereq":[{"skill":"falconry-mastery","level":1}],"desc":"ตีปกติโดนแล้วมีโอกาส (LUK ÷ 3)% ที่เหยี่ยวพุ่งจิกศัตรูเอง (LUK 99 = 33%) จำนวนจิกเท่ากับ Falcon Strike เลเวลที่มีอยู่ (เช่น Lv.10 = 6 ครั้ง;..."},
    {"id":"land-mine","name":"Blast Mine","thai":"กับระเบิด","maxLevel":10,"kind":"active","desc":"วางกับระเบิดบนพื้น มอนเดินมาชนแล้วระเบิด ธาตุดิน โดนรอบจุดวาง มีโอกาสทำให้มึนงง ไม่มีใครชน 60 วิหายไป วางได้พร้อมกัน 3 อัน (อันที่ 4 แทนอันเ...","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"tremor","name":"Tremor","thai":"ธรณีสั่น","desc":"เป้าที่โดน DEF -7% 4 วิ"}]},{"lv":12,"opts":[{"id":"concussive","name":"Concussive","thai":"แรงกระแทก","desc":"ศัตรูที่โดนช้าลง 28% 3 วิ"},{"id":"lingering","name":"Lingering","thai":"สถานะยืดเยื้อ","desc":"เวลาสถานะที่สกิลทำ +56%"},{"id":"aftershock","name":"Aftershock","thai":"แรงสั่นสะเทือน","desc":"พื้นสั่นซ้ำหลัง 1 วิ ทุกตัวในพื้นที่โดน 189% ของดาเมจสกิล"}]},{"lv":15,"opts":[{"id":"overload","name":"Overload","thai":"ทุ่มสุดตัว","desc":"ดาเมจ +60% แต่คูลดาวน์ +50%"},{"id":"wider","name":"Vast","thai":"กว้างไกล","desc":"พื้นที่ +2 ช่อง แต่ดาเมจ -15%"},{"id":"overkill","name":"Overkill","thai":"ดาเมจล้น","desc":"ดาเมจที่เกินตอนฆ่า 167% ไหลไปศัตรูใกล้สุดใน 5 ช่อง"}]}]},
    {"id":"ankle-snare","name":"Snare Trap","thai":"กับดักข้อเท้า","maxLevel":10,"kind":"active","req":"กับระเบิด Lv.1","prereq":[{"skill":"land-mine","level":1}],"desc":"วางกับดักข้อเท้าบนพื้น มอนเดินมาเหยียบแล้วถูกล็อกขา เดินไม่ได้ (ยังตีได้ถ้าอยู่ในระยะ) 3.5–8 วิ ไม่มีใครเหยียบ 60 วิหายไป วางได้พร้อมกัน 3 อ...","facets":[{"lv":3,"opts":[{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"},{"id":"sure-status","name":"Sure Status","thai":"ติดแน่น","desc":"โอกาสติดสถานะของสกิลนี้ +8% (ไม่ใช่สกิลโจมตี); ดีบัฟที่ติดแน่นอนอยู่แล้ว (Strip Armor, Provoke, Quagmire) อยู่นานขึ้น 8% แทน"}]},{"lv":6,"opts":[{"id":"lingering","name":"Lingering","thai":"สถานะยืดเยื้อ","desc":"เวลาสถานะที่สกิลทำ +56%"},{"id":"exploit","name":"Exploit","thai":"ซ้ำเติม","desc":"มอนที่ติดสถานะ / ดีบัฟจากสกิลนี้รับดาเมจจากทุกคนเพิ่ม 8% (บอสครึ่งหนึ่ง)"},{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"}]},{"lv":10,"opts":[{"id":"master","name":"Master","thai":"ชำนาญ","desc":"คูลดาวน์ -50%, เวลาร่าย -50%"},{"id":"free","name":"Effortless","thai":"ไร้แรง","desc":"SP -70%"},{"id":"long-reach","name":"Long Reach","thai":"ระยะไกล","desc":"ระยะร่าย +3 ช่อง"}]}]},
    {"id":"claymore-trap","name":"Inferno Trap","thai":"กับดักเพลิง","maxLevel":10,"kind":"active","req":"กับระเบิด Lv.3","prereq":[{"skill":"land-mine","level":3}],"desc":"วางกับดักเพลิงบนพื้น มอนเดินมาชนแล้วระเบิดวงกว้าง ธาตุไฟ ไม่มีใครชน 60 วิหายไป วางได้พร้อมกัน 3 อัน (อันที่ 4 แทนอันเก่าสุด) · แรงขึ้นตาม IN...","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"ignite","name":"Ignite","thai":"เพลิงลาม","desc":"ศัตรูที่โดนติดไฟ เผาไหม้ 30% ของดาเมจต่อวิ 3 วิ"}]},{"lv":12,"opts":[{"id":"concussive","name":"Concussive","thai":"แรงกระแทก","desc":"ศัตรูที่โดนช้าลง 28% 3 วิ"},{"id":"aftershock","name":"Aftershock","thai":"แรงสั่นสะเทือน","desc":"พื้นสั่นซ้ำหลัง 1 วิ ทุกตัวในพื้นที่โดน 189% ของดาเมจสกิล"},{"id":"vortex","name":"Vortex","thai":"วังวน","desc":"ดูดศัตรูในพื้นที่เข้าหากลางวง 1.5 ช่องก่อนโดน"}]},{"lv":15,"opts":[{"id":"overload","name":"Overload","thai":"ทุ่มสุดตัว","desc":"ดาเมจ +60% แต่คูลดาวน์ +50%"},{"id":"wider","name":"Vast","thai":"กว้างไกล","desc":"พื้นที่ +2 ช่อง แต่ดาเมจ -15%"},{"id":"overkill","name":"Overkill","thai":"ดาเมจล้น","desc":"ดาเมจที่เกินตอนฆ่า 167% ไหลไปศัตรูใกล้สุดใน 5 ช่อง"}]}]},
    {"id":"detecting","name":"Falcon Scout","thai":"เหยี่ยวสอดแนม","maxLevel":1,"kind":"active","desc":"ปล่อยเหยี่ยวบินวนจิกในพื้นที่รัศมี 6 ช่อง ไม่มีดาเมจ ผู้เล่นฝ่ายศัตรูที่หายตัวอยู่ในวงจะโผล่ออกมา ต้องมีเหยี่ยว","facets":[{"lv":1,"opts":[{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"},{"id":"eagle-eye","name":"Eagle Eye","thai":"ตาเหยี่ยว","desc":"ระยะเปิดเผย / มองเห็นของสกิลนี้ +1 ช่อง"}]},{"lv":1,"opts":[{"id":"hunters-mark","name":"Hunters Mark","thai":"ตามรอย","desc":"มอนที่ถูกเปิดเผย / อยู่ในระยะมองเห็น รับดาเมจจากทุกคนเพิ่ม 8% 8 วิ (ไม่เกิน 10 ตัวต่อการร่าย)"},{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"},{"id":"wide","name":"Wide","thai":"แผ่กว้าง","desc":"พื้นที่ +1 ช่อง"}]},{"lv":1,"opts":[{"id":"master","name":"Master","thai":"ชำนาญ","desc":"คูลดาวน์ -50%, เวลาร่าย -50%"},{"id":"free","name":"Effortless","thai":"ไร้แรง","desc":"SP -70%"},{"id":"long-reach","name":"Long Reach","thai":"ระยะไกล","desc":"ระยะร่าย +3 ช่อง"}]}]}
  ], "bard": [
    {"id":"musical-strike","name":"Melody Arrow","thai":"ศรทำนอง","maxLevel":10,"kind":"active","req":"ยิงคู่ Lv.3","prereq":[{"skill":"double-strafe","level":3}],"desc":"ยิงลูกศรที่พาเสียงดนตรีพุ่งใส่เป้าหมาย ใช้ลูกธนู 1 ดอกต่อครั้ง (ต้องติดตั้งลูกธนูไว้ ถือเครื่องดนตรีก็ยิงได้) ธาตุตามลูกธนูที่ใส่อยู่","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"}]},{"lv":12,"opts":[{"id":"piercing","name":"Piercing","thai":"ทะลวง","desc":"ทะลุเป้าไปโดนศัตรูทุกตัวด้านหลังในแนวยาว 6 ช่อง กว้าง 2 ช่อง แต่ละตัวโดน 116% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"},{"id":"executioner","name":"Executioner","thai":"เพชฌฆาต","desc":"ดาเมจ +566% กับเป้าที่เลือดต่ำกว่า 30%"},{"id":"chain","name":"Chain","thai":"ลูกโซ่","desc":"เด้งต่อไปยังศัตรูตัวที่ใกล้ที่สุดในระยะ 4 ช่อง ทีละตัว 2-3 ตัว แต่ละตัวโดน 66% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"}]},{"lv":15,"opts":[{"id":"overload","name":"Overload","thai":"ทุ่มสุดตัว","desc":"ดาเมจ +60% แต่คูลดาวน์ +50%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"detonate","name":"Detonate","thai":"ระเบิดศพ","desc":"ศัตรูที่ตายจากสกิลนี้ระเบิด ทำดาเมจ 90% ของ HP สูงสุดของตัวที่ตาย ใส่ศัตรูรอบ 5 ช่อง (ไม่เกิน 3 เท่าของดาเมจที่ฆ่า) ตัวที่ตายจากแรงระเบิดจะระเบิดต่ออีก 1 ทอด"}]}]},
    {"id":"frost-joke","name":"Chilling Jest","thai":"มุกเยือกแข็ง","maxLevel":10,"kind":"active","req":"ศรทำนอง Lv.3","prereq":[{"skill":"musical-strike","level":3}],"desc":"เล่นมุกตลกหนาวเหน็บ มอนรอบตัวมีโอกาสแข็งตัว","facets":[{"lv":3,"opts":[{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"},{"id":"sure-status","name":"Sure Status","thai":"ติดแน่น","desc":"โอกาสติดสถานะของสกิลนี้ +8% (ไม่ใช่สกิลโจมตี); ดีบัฟที่ติดแน่นอนอยู่แล้ว (Strip Armor, Provoke, Quagmire) อยู่นานขึ้น 8% แทน"}]},{"lv":6,"opts":[{"id":"lingering","name":"Lingering","thai":"สถานะยืดเยื้อ","desc":"เวลาสถานะที่สกิลทำ +56%"},{"id":"exploit","name":"Exploit","thai":"ซ้ำเติม","desc":"มอนที่ติดสถานะ / ดีบัฟจากสกิลนี้รับดาเมจจากทุกคนเพิ่ม 8% (บอสครึ่งหนึ่ง)"},{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"}]},{"lv":10,"opts":[{"id":"master","name":"Master","thai":"ชำนาญ","desc":"คูลดาวน์ -50%, เวลาร่าย -50%"},{"id":"free","name":"Effortless","thai":"ไร้แรง","desc":"SP -70%"},{"id":"long-reach","name":"Long Reach","thai":"ระยะไกล","desc":"ระยะร่าย +3 ช่อง"}]}]},
    {"id":"poem-of-bragi","name":"Ballad of Swiftcast","thai":"บทเพลงเร่งเวท","maxLevel":10,"kind":"active","desc":"บทเพลงที่ทำให้ร่ายเวทเร็วขึ้น เพิ่ม DEX และ INT (เล่นได้ทีละ 1 เพลง เพลงใหม่แทนเพลงเดิม · เพลงของ Bard กับท่าเต้นของ Dancer อยู่บนตัวผู้เล่น...","facetsPending":true},
    {"id":"assassin-cross-of-sunset","name":"Dusk Tempo","thai":"เพลงยามอัสดง","maxLevel":10,"kind":"active","req":"บทเพลงเร่งเวท Lv.3","prereq":[{"skill":"poem-of-bragi","level":3}],"desc":"บทเพลงเร่งจังหวะ เพิ่มความเร็วโจมตี (เล่นได้ทีละ 1 เพลง เพลงใหม่แทนเพลงเดิม · เพลงของ Bard กับท่าเต้นของ Dancer อยู่บนตัวผู้เล่นพร้อมกันได้)","facetsPending":true},
    {"id":"apple-of-idun","name":"Song of Renewal","thai":"เพลงฟื้นชีวา","maxLevel":10,"kind":"active","req":"บทเพลงเร่งเวท Lv.3","prereq":[{"skill":"poem-of-bragi","level":3}],"desc":"บทเพลงแห่งชีวิต เพิ่ม HP สูงสุดและพลังการฟื้นฟู (เล่นได้ทีละ 1 เพลง เพลงใหม่แทนเพลงเดิม · เพลงของ Bard กับท่าเต้นของ Dancer อยู่บนตัวผู้เล่น...","facetsPending":true}
  ], "dancer": [
    {"id":"throw-arrow","name":"Dancing Arrow","thai":"เหวี่ยงศร","maxLevel":10,"kind":"active","req":"ยิงคู่ Lv.3","prereq":[{"skill":"double-strafe","level":3}],"desc":"หมุนตัวเหวี่ยงลูกศรใส่เป้าหมาย ใช้ลูกธนู 1 ดอกต่อครั้ง (ต้องติดตั้งลูกธนูไว้ ถือแส้ก็ยิงได้) ธาตุตามลูกธนูที่ใส่อยู่","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"}]},{"lv":12,"opts":[{"id":"executioner","name":"Executioner","thai":"เพชฌฆาต","desc":"ดาเมจ +566% กับเป้าที่เลือดต่ำกว่า 30%"},{"id":"chain","name":"Chain","thai":"ลูกโซ่","desc":"เด้งต่อไปยังศัตรูตัวที่ใกล้ที่สุดในระยะ 4 ช่อง ทีละตัว 2-3 ตัว แต่ละตัวโดน 66% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"},{"id":"fork","name":"Fork","thai":"แยกทาง","desc":"ยิงเพิ่ม 2 ลูกไปหาศัตรูตัวอื่นที่อยู่ภายใน 3 ช่องรอบเป้า แต่ละลูกโดน 101% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"}]},{"lv":15,"opts":[{"id":"overload","name":"Overload","thai":"ทุ่มสุดตัว","desc":"ดาเมจ +60% แต่คูลดาวน์ +50%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"piercing","name":"Piercing","thai":"ทะลวง","desc":"ทะลุเป้าไปโดนศัตรูทุกตัวด้านหลังในแนวยาว 6 ช่อง กว้าง 2 ช่อง แต่ละตัวโดน 129% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"}]}]},
    {"id":"service-for-you","name":"Enchanting Dance","thai":"ระบำบริการ","maxLevel":10,"kind":"active","desc":"ท่าเต้นที่เพิ่ม SP สูงสุดและ INT (เล่นได้ทีละ 1 เพลง เพลงใหม่แทนเพลงเดิม · เพลงของ Bard กับท่าเต้นของ Dancer อยู่บนตัวผู้เล่นพร้อมกันได้)","facetsPending":true},
    {"id":"fortune-kiss","name":"Lucky Kiss","thai":"จุมพิตแห่งโชค","maxLevel":10,"kind":"active","req":"ระบำบริการ Lv.3","prereq":[{"skill":"service-for-you","level":3}],"desc":"ส่งจูบนำโชค เพิ่มโอกาสคริติคอล (เล่นได้ทีละ 1 เพลง เพลงใหม่แทนเพลงเดิม · เพลงของ Bard กับท่าเต้นของ Dancer อยู่บนตัวผู้เล่นพร้อมกันได้)","facetsPending":true},
    {"id":"scream","name":"Banshee Scream","thai":"กรีดร้อง","maxLevel":10,"kind":"active","req":"จุมพิตแห่งโชค Lv.1","prereq":[{"skill":"fortune-kiss","level":1}],"desc":"กรีดร้องสุดเสียง มอนรอบตัวมีโอกาสมึนงง","facets":[{"lv":3,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"concussive","name":"Concussive","thai":"แรงกระแทก","desc":"ศัตรูที่โดนช้าลง 18% 3 วิ"}]},{"lv":6,"opts":[{"id":"epicenter","name":"Epicenter","thai":"จุดศูนย์กลาง","desc":"ศัตรูกลางวง 1 ช่องรับดาเมจ +184%"},{"id":"lingering","name":"Lingering","thai":"สถานะยืดเยื้อ","desc":"เวลาสถานะที่สกิลทำ +56%"},{"id":"aftershock","name":"Aftershock","thai":"แรงสั่นสะเทือน","desc":"พื้นสั่นซ้ำหลัง 1 วิ ทุกตัวในพื้นที่โดน 189% ของดาเมจสกิล"}]},{"lv":10,"opts":[{"id":"overload","name":"Overload","thai":"ทุ่มสุดตัว","desc":"ดาเมจ +60% แต่คูลดาวน์ +50%"},{"id":"wider","name":"Vast","thai":"กว้างไกล","desc":"พื้นที่ +2 ช่อง แต่ดาเมจ -15%"},{"id":"detonate","name":"Detonate","thai":"ระเบิดศพ","desc":"ศัตรูที่ตายจากสกิลนี้ระเบิด ทำดาเมจ 90% ของ HP สูงสุดของตัวที่ตาย ใส่ศัตรูรอบ 5 ช่อง (ไม่เกิน 3 เท่าของดาเมจที่ฆ่า) ตัวที่ตายจากแรงระเบิดจะระเบิดต่ออีก 1 ทอด"}]}]},
    {"id":"humming","name":"Humming","thai":"ฮัมเพลงแม่นยำ","maxLevel":10,"kind":"active","desc":"ท่าเต้นพร้อมเสียงฮัม เพิ่ม HIT +2 ต่อเลเวล (Lv.10 +20) (เล่นได้ทีละ 1 เพลง เพลงใหม่แทนเพลงเดิม · เพลงของ Bard กับท่าเต้นของ Dancer อยู่บนตัว..."}
  ], "priest": [
    {"id":"magnus-exorcismus","name":"Holy Judgment","thai":"มหาไล่ผี","maxLevel":10,"kind":"active","req":"แสงศักดิ์สิทธิ์ Lv.5","prereq":[{"skill":"holy-light","level":5}],"desc":"กางเขนแสงยักษ์ปักลงพื้น วงรัศมี 5 ช่อง ศัตรูในวงโดนดาเมจเวทศักดิ์สิทธิ์ 10 ครั้ง (Lv.10 ครั้งละ 150%) มอนเผ่า Undead และ Demon โดนแรงเป็น 2 ...","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"sanctify","name":"Sanctify","thai":"ชำระบาป","desc":"ดาเมจกับอันเดดและปีศาจ +9%"}]},{"lv":12,"opts":[{"id":"spell-cascade","name":"Spell Cascade","thai":"เวทลดหลั่น","desc":"เกิดพื้นที่เล็กซ้ำ 2 จุดครึ่งทางจากกลางวงออกไป ดาเมจ 100% ของทั้งสกิล"},{"id":"concussive","name":"Concussive","thai":"แรงกระแทก","desc":"ศัตรูที่โดนช้าลง 28% 3 วิ"},{"id":"aftershock","name":"Aftershock","thai":"แรงสั่นสะเทือน","desc":"พื้นสั่นซ้ำหลัง 1 วิ ทุกตัวในพื้นที่โดน 189% ของดาเมจสกิล"}]},{"lv":15,"opts":[{"id":"one-strike","name":"One Strike","thai":"รวมพลัง","desc":"ทุกครั้งรวมเป็นครั้งเดียว แรงเท่ารวมกัน ดาเมจ +10%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"overkill","name":"Overkill","thai":"ดาเมจล้น","desc":"ดาเมจที่เกินตอนฆ่า 167% ไหลไปศัตรูใกล้สุดใน 5 ช่อง"}]}]},
    {"id":"kyrie-eleison","name":"Divine Shield","thai":"โล่ศักดิ์สิทธิ์","maxLevel":10,"kind":"active","req":"แสงเยียวยา Lv.3","prereq":[{"skill":"heal","level":3}],"desc":"โล่แสงปกป้อง ลดดาเมจที่ได้รับ","facetsPending":true},
    {"id":"impositio-manus","name":"Blessed Might","thai":"หัตถ์ประทานพลัง","maxLevel":10,"kind":"active","desc":"วางมืออวยพร เพิ่มพลังโจมตี","facetsPending":true},
    {"id":"gloria","name":"Hymn of Fortune","thai":"บทสรรเสริญ","maxLevel":5,"kind":"active","req":"โล่ศักดิ์สิทธิ์ Lv.4","prereq":[{"skill":"kyrie-eleison","level":4}],"desc":"ขับร้องบทสรรเสริญ เพิ่ม LUK ให้ตัวเองและปาร์ตี้ เลเวลละ 6 (Lv.5 = +30) นาน 30 วินาที"},
    {"id":"sanctuary","name":"Holy Ground","thai":"แดนศักดิ์สิทธิ์","maxLevel":10,"kind":"active","req":"แสงเยียวยา Lv.5","prereq":[{"skill":"heal","level":5}],"desc":"วางวงศักดิ์สิทธิ์บนพื้น รัศมี 2.5 ช่อง ฟื้น HP ผู้เล่นทุกคนที่ยืนในวงทุก 1 วินาที (Lv.10 = 777 HP/วินาที) อยู่ 10 วินาที + 1 วินาทีต่อเลเวล ..."},
    {"id":"aspersio","name":"Holy Water","thai":"น้ำมนต์","maxLevel":5,"kind":"active","req":"หัตถ์ประทานพลัง Lv.3","prereq":[{"skill":"impositio-manus","level":3}],"desc":"ประพรมน้ำมนต์ อาวุธของเป้าหมายกลายเป็นธาตุศักดิ์สิทธิ์ (ใช้กับตัวเองหรือเพื่อนในปาร์ตี้เท่านั้น)"},
    {"id":"pneuma","name":"Wind Veil","thai":"ม่านลมคุ้มภัย","maxLevel":1,"kind":"active","desc":"วางวงเวทบนพื้น ใครยืนในวงไม่โดนการโจมตีระยะไกลทางกายภาพ (ธนู, มอนยิงไกล) ระยะประชิดและเวทยังโดน อยู่ 10 วินาที","facets":[{"lv":1,"opts":[{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"},{"id":"enduring-ground","name":"Enduring Ground","thai":"เขตยืนยง","desc":"โซนของสกิลนี้อยู่นานขึ้น 20%"}]},{"lv":1,"opts":[{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"},{"id":"wide","name":"Wide","thai":"แผ่กว้าง","desc":"พื้นที่ +1 ช่อง"},{"id":"efficient","name":"Efficient","thai":"ประหยัด","desc":"SP -50%"}]},{"lv":1,"opts":[{"id":"master","name":"Master","thai":"ชำนาญ","desc":"คูลดาวน์ -50%, เวลาร่าย -50%"},{"id":"free","name":"Effortless","thai":"ไร้แรง","desc":"SP -70%"},{"id":"long-reach","name":"Long Reach","thai":"ระยะไกล","desc":"ระยะร่าย +3 ช่อง"}]}]},
    {"id":"resurrection","name":"Rebirth","thai":"ชุบชีวิต","maxLevel":4,"kind":"active","req":"หัตถ์ประทานพลัง Lv.3","prereq":[{"skill":"impositio-manus","level":3}],"desc":"ชุบชีวิตผู้เล่นที่ตาย ณ จุดที่ล้ม ฟื้นมาพร้อม HP 12% +22% ต่อเลเวล (Lv.4 = 78%) ใช้กับคนที่ยังไม่ตายไม่ได้","facets":[{"lv":1,"opts":[{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"},{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"}]},{"lv":2,"opts":[{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"},{"id":"efficient","name":"Efficient","thai":"ประหยัด","desc":"SP -50%"},{"id":"reach","name":"Reach","thai":"ระยะยาว","desc":"ระยะร่าย +2 ช่อง"}]},{"lv":3,"opts":[{"id":"master","name":"Master","thai":"ชำนาญ","desc":"คูลดาวน์ -50%, เวลาร่าย -50%"},{"id":"free","name":"Effortless","thai":"ไร้แรง","desc":"SP -70%"},{"id":"long-reach","name":"Long Reach","thai":"ระยะไกล","desc":"ระยะร่าย +3 ช่อง"}]}]},
    {"id":"priest-safety-wall","name":"Aegis Barrier","thai":"กำแพงนิรภัย","maxLevel":10,"kind":"active","desc":"วางวงเวทบนพื้น ใครยืนในวงไม่โดนดาเมจกายภาพ (เวทยังโดน) อยู่ 8 วินาที +3 ต่อเลเวล · กันได้ (เลเวล+1) ครั้งแล้วแตก (Lv.10: 11 ครั้ง)","facets":[{"lv":3,"opts":[{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"},{"id":"enduring-ground","name":"Enduring Ground","thai":"เขตยืนยง","desc":"โซนของสกิลนี้อยู่นานขึ้น 20%"}]},{"lv":6,"opts":[{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"},{"id":"wide","name":"Wide","thai":"แผ่กว้าง","desc":"พื้นที่ +1 ช่อง"},{"id":"efficient","name":"Efficient","thai":"ประหยัด","desc":"SP -50%"}]},{"lv":10,"opts":[{"id":"master","name":"Master","thai":"ชำนาญ","desc":"คูลดาวน์ -50%, เวลาร่าย -50%"},{"id":"free","name":"Effortless","thai":"ไร้แรง","desc":"SP -70%"},{"id":"long-reach","name":"Long Reach","thai":"ระยะไกล","desc":"ระยะร่าย +3 ช่อง"}]}]},
    {"id":"purifying-light","name":"Purifying Light","thai":"แสงชำระล้าง","maxLevel":1,"kind":"active","req":"โล่ศักดิ์สิทธิ์ Lv.3","prereq":[{"skill":"kyrie-eleison","level":3}],"desc":"แสงศักดิ์สิทธิ์ชำระล้างตัวเองและปาร์ตี้ในระยะ 13 ช่อง ล้างมึน แช่แข็ง และสโลว์จากบอส แล้วกันไม่ให้ติดใหม่ 3 วินาที","facets":[{"lv":1,"opts":[{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"},{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"}]},{"lv":1,"opts":[{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"},{"id":"efficient","name":"Efficient","thai":"ประหยัด","desc":"SP -50%"},{"id":"reach","name":"Reach","thai":"ระยะยาว","desc":"ระยะร่าย +2 ช่อง"}]},{"lv":1,"opts":[{"id":"master","name":"Master","thai":"ชำนาญ","desc":"คูลดาวน์ -50%, เวลาร่าย -50%"},{"id":"free","name":"Effortless","thai":"ไร้แรง","desc":"SP -70%"},{"id":"long-reach","name":"Long Reach","thai":"ระยะไกล","desc":"ระยะร่าย +3 ช่อง"}]}]}
  ], "monk": [
    {"id":"iron-fists","name":"Steel Knuckles","thai":"หมัดเหล็ก","maxLevel":10,"kind":"passive","desc":"เพิ่มพลังโจมตีเมื่อใช้สนับมือ"},
    {"id":"triple-attack","name":"Threefold Strike","thai":"หมัดสามจังหวะ","maxLevel":10,"kind":"passive","desc":"ตีปกติมีโอกาส 30% -1% ต่อเลเวล ต่อยสามหมัดติด รวมพลัง 120% +20% ต่อเลเวลของ ATK (Lv.10 = 320%) ใช้ได้ทุกอาวุธ"},
    {"id":"call-spirits","name":"Summon Spirit Orbs","thai":"เรียกลูกแก้ววิญญาณ","maxLevel":10,"kind":"active","req":"หมัดเหล็ก Lv.2","prereq":[{"skill":"iron-fists","level":2}],"desc":"เรียกลูกแก้ววิญญาณ 1 เม็ดต่อครั้ง (มีได้เท่าเลเวลสกิล สูงสุด 5 เม็ด) ลูกแก้วโคจรรอบตัว เม็ดละ ATK +6 ครบ 5 เม็ด ATK +5% อีก · เรียกเพิ่มแล้ว...","facetsPending":true},
    {"id":"finger-offensive","name":"Spirit Shot","thai":"ดีดลูกแก้ววิญญาณ","maxLevel":10,"kind":"active","req":"เรียกลูกแก้ววิญญาณ Lv.3","prereq":[{"skill":"call-spirits","level":3}],"desc":"ดีดลูกแก้ววิญญาณใส่เป้าหมายระยะไกล จำนวนลูกเพิ่มตามเลเวล","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"}]},{"lv":12,"opts":[{"id":"chain","name":"Chain","thai":"ลูกโซ่","desc":"เด้งต่อไปยังศัตรูตัวที่ใกล้ที่สุดในระยะ 4 ช่อง ทีละตัว 2-3 ตัว แต่ละตัวโดน 66% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"},{"id":"fork","name":"Fork","thai":"แยกทาง","desc":"ยิงเพิ่ม 2 ลูกไปหาศัตรูตัวอื่นที่อยู่ภายใน 3 ช่องรอบเป้า แต่ละลูกโดน 101% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"},{"id":"piercing","name":"Piercing","thai":"ทะลวง","desc":"ทะลุเป้าไปโดนศัตรูทุกตัวด้านหลังในแนวยาว 6 ช่อง กว้าง 2 ช่อง แต่ละตัวโดน 116% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"}]},{"lv":15,"opts":[{"id":"one-strike","name":"One Strike","thai":"รวมพลัง","desc":"ทุกครั้งรวมเป็นครั้งเดียว แรงเท่ารวมกัน ดาเมจ +10%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"overkill","name":"Overkill","thai":"ดาเมจล้น","desc":"ดาเมจที่เกินตอนฆ่า 167% ไหลไปศัตรูใกล้สุดใน 5 ช่อง"}]}]},
    {"id":"six-saint","name":"Six-Step Leap","thai":"หกก้าวเทพ","maxLevel":3,"kind":"active","req":"หมัดสามจังหวะ Lv.5","prereq":[{"skill":"triple-attack","level":5}],"desc":"กระโดดไปยังจุดที่คลิกทันที ไม่มีร่าย ไม่มีดาเมจ ระยะ 7 ช่อง คูลดาวน์ 1.5 วิ ลดลงทุกเลเวล (Lv.2 = 0.85 วิ, Lv.3 = 0.2 วิ)","facets":[{"lv":1,"opts":[{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"},{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"}]},{"lv":2,"opts":[{"id":"swift","name":"Swift","thai":"ฉับไว","desc":"คูลดาวน์ -40%, SP -20%"},{"id":"wide","name":"Wide","thai":"แผ่กว้าง","desc":"พื้นที่ +1 ช่อง"},{"id":"efficient","name":"Efficient","thai":"ประหยัด","desc":"SP -50%"}]},{"lv":3,"opts":[{"id":"master","name":"Master","thai":"ชำนาญ","desc":"คูลดาวน์ -50%, เวลาร่าย -50%"},{"id":"free","name":"Effortless","thai":"ไร้แรง","desc":"SP -70%"},{"id":"long-reach","name":"Long Reach","thai":"ระยะไกล","desc":"ระยะร่าย +3 ช่อง"}]}]},
    {"id":"investigate","name":"Piercing Palm","thai":"ฝ่ามือทะลวง","maxLevel":10,"kind":"active","req":"เรียกลูกแก้ววิญญาณ Lv.5","prereq":[{"skill":"call-spirits","level":5}],"desc":"กระแทกฝ่ามือทะลุเกราะ ไม่โดนหักพลังป้องกัน ยิ่งศัตรู DEF สูงยิ่งแรง (+1% ต่อ DEF 1 แต้ม) และลดพลังป้องกันของเป้าหมาย","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"crushing-blow","name":"Crushing Blow","thai":"ทุบสะท้าน","desc":"โอกาส 14% มึน 1.5 วิ"}]},{"lv":12,"opts":[{"id":"lingering","name":"Lingering","thai":"สถานะยืดเยื้อ","desc":"เวลาสถานะที่สกิลทำ +56%"},{"id":"cleave","name":"Cleave","thai":"ฟันกวาด","desc":"ศัตรูรอบเป้าในระยะ 1 ช่อง โดน 82% ของดาเมจสกิลด้วย (ใช้กับสกิลเป้าเดียว)"},{"id":"executioner","name":"Executioner","thai":"เพชฌฆาต","desc":"ดาเมจ +566% กับเป้าที่เลือดต่ำกว่า 30%"}]},{"lv":15,"opts":[{"id":"overload","name":"Overload","thai":"ทุ่มสุดตัว","desc":"ดาเมจ +60% แต่คูลดาวน์ +50%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"overkill","name":"Overkill","thai":"ดาเมจล้น","desc":"ดาเมจที่เกินตอนฆ่า 167% ไหลไปศัตรูใกล้สุดใน 5 ช่อง"}]}]},
    {"id":"asura-strike","name":"Asura Fist","thai":"หมัดอสูร","maxLevel":10,"kind":"active","req":"ฝ่ามือทะลวง Lv.5, ดีดลูกแก้ววิญญาณ Lv.3","prereq":[{"skill":"investigate","level":5},{"skill":"finger-offensive","level":3}],"desc":"ทุ่ม SP ทั้งหมดเป็นหมัดเดียว (เหลือ SP 1) ยิ่งมี SP เยอะยิ่งแรง: พลัง ATK × (15 + 1 ต่อเลเวล + SP ที่ใช้ × 0.15) ร่าย 1.5 วินาที โดนเสมอ · ห...","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"crushing-blow","name":"Crushing Blow","thai":"ทุบสะท้าน","desc":"โอกาส 14% มึน 1.5 วิ"}]},{"lv":12,"opts":[{"id":"cleave","name":"Cleave","thai":"ฟันกวาด","desc":"ศัตรูรอบเป้าในระยะ 1 ช่อง โดน 82% ของดาเมจสกิลด้วย (ใช้กับสกิลเป้าเดียว)"},{"id":"executioner","name":"Executioner","thai":"เพชฌฆาต","desc":"ดาเมจ +566% กับเป้าที่เลือดต่ำกว่า 30%"},{"id":"overheat","name":"Overheat","thai":"ทุ่มแรง","desc":"ดาเมจ +35% แต่คูลดาวน์ +40%"}]},{"lv":15,"opts":[{"id":"overload","name":"Overload","thai":"ทุ่มสุดตัว","desc":"ดาเมจ +60% แต่คูลดาวน์ +50%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"overkill","name":"Overkill","thai":"ดาเมจล้น","desc":"ดาเมจที่เกินตอนฆ่า 167% ไหลไปศัตรูใกล้สุดใน 5 ช่อง"}]}]},
    {"id":"fury","name":"Fury","thai":"พลังโทสะ","maxLevel":1,"kind":"active","req":"เรียกลูกแก้ววิญญาณ Lv.5","prereq":[{"skill":"call-spirits","level":5}],"desc":"ต้องมีลูกแก้ววิญญาณอย่างน้อย 3 เม็ด ใช้ลูกแก้วหมดทุกเม็ด แล้ว 3 นาที: อัตราคริ +10% และความแรงคริติคอล +5% · คูลดาวน์ 8 วินาที"}
  ], "blacksmith": [
    {"id":"weaponry-research","name":"Forge Expertise","thai":"วิจัยอาวุธ","maxLevel":10,"kind":"passive","desc":"เพิ่มพลังโจมตีและความแม่นยำถาวร"},
    {"id":"two-hand-axe-mastery","name":"Greataxe Mastery","thai":"ชำนาญขวานสองมือ","maxLevel":10,"kind":"passive","desc":"ถือขวานสองมือ ATK +4 ต่อเลเวล"},
    {"id":"hammer-fall","name":"Earthshaker","thai":"ทุบพสุธา","maxLevel":10,"kind":"active","desc":"ทุบพื้นให้สะเทือน ทำความเสียหายศัตรูรอบตัว และมีโอกาสทำให้มึนงง","facets":[{"lv":3,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"concussive","name":"Concussive","thai":"แรงกระแทก","desc":"ศัตรูที่โดนช้าลง 18% 3 วิ"}]},{"lv":6,"opts":[{"id":"lingering","name":"Lingering","thai":"สถานะยืดเยื้อ","desc":"เวลาสถานะที่สกิลทำ +56%"},{"id":"aftershock","name":"Aftershock","thai":"แรงสั่นสะเทือน","desc":"พื้นสั่นซ้ำหลัง 1 วิ ทุกตัวในพื้นที่โดน 189% ของดาเมจสกิล"},{"id":"vortex","name":"Vortex","thai":"วังวน","desc":"ดูดศัตรูในพื้นที่เข้าหากลางวง 1.5 ช่องก่อนโดน"}]},{"lv":10,"opts":[{"id":"overload","name":"Overload","thai":"ทุ่มสุดตัว","desc":"ดาเมจ +60% แต่คูลดาวน์ +50%"},{"id":"wider","name":"Vast","thai":"กว้างไกล","desc":"พื้นที่ +2 ช่อง แต่ดาเมจ -15%"},{"id":"epicenter","name":"Epicenter","thai":"จุดศูนย์กลาง","desc":"ศัตรูกลางวง 1 ช่องรับดาเมจ +217%"}]}]},
    {"id":"adrenaline-rush","name":"Battle Frenzy","thai":"อะดรีนาลีนพลุ่ง","maxLevel":10,"kind":"active","req":"ทุบพสุธา Lv.2","prereq":[{"skill":"hammer-fall","level":2}],"desc":"เลือดสูบฉีด เพิ่มความเร็วโจมตี (ตัวเองและสมาชิกปาร์ตี้ในระยะ 13 ช่อง)","facetsPending":true},
    {"id":"over-thrust","name":"Overdrive","thai":"พลังเหนือขีด","maxLevel":10,"kind":"active","req":"อะดรีนาลีนพลุ่ง Lv.4","prereq":[{"skill":"adrenaline-rush","level":4}],"desc":"ปลุกพลังอาวุธของตัวเองและปาร์ตี้ เพิ่มดาเมจระยะประชิด (ตัวเองและสมาชิกปาร์ตี้ในระยะ 13 ช่อง)","facetsPending":true},
    {"id":"weapon-perfection","name":"True Edge","thai":"อาวุธสมบูรณ์แบบ","maxLevel":10,"kind":"active","req":"วิจัยอาวุธ Lv.2","prereq":[{"skill":"weaponry-research","level":2}],"desc":"ลับอาวุธจนคมกริบ เพิ่มความแม่นยำและดาเมจคริติคอล (ตัวเองและสมาชิกปาร์ตี้ในระยะ 13 ช่อง)","facetsPending":true}
  ], "alchemist": [
    {"id":"acid-terror","name":"Acid Flask","thai":"ขวดกรดกัดเกราะ","maxLevel":10,"kind":"active","desc":"ขว้างขวดกรด ทำดาเมจและกัดพลังป้องกันของเป้าหมาย ศัตรูที่ยืนบนพื้นไฟ Firebomb โดนแรงขึ้น 50%","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"}]},{"lv":12,"opts":[{"id":"executioner","name":"Executioner","thai":"เพชฌฆาต","desc":"ดาเมจ +566% กับเป้าที่เลือดต่ำกว่า 30%"},{"id":"lingering","name":"Lingering","thai":"สถานะยืดเยื้อ","desc":"เวลาสถานะที่สกิลทำ +56%"},{"id":"chain","name":"Chain","thai":"ลูกโซ่","desc":"เด้งต่อไปยังศัตรูตัวที่ใกล้ที่สุดในระยะ 4 ช่อง ทีละตัว 2-3 ตัว แต่ละตัวโดน 66% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"}]},{"lv":15,"opts":[{"id":"overload","name":"Overload","thai":"ทุ่มสุดตัว","desc":"ดาเมจ +60% แต่คูลดาวน์ +50%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"piercing","name":"Piercing","thai":"ทะลวง","desc":"ทะลุเป้าไปโดนศัตรูทุกตัวด้านหลังในแนวยาว 6 ช่อง กว้าง 2 ช่อง แต่ละตัวโดน 129% ของดาเมจสกิล (ใช้กับสกิลเป้าเดียว)"}]}]},
    {"id":"demonstration","name":"Firebomb","thai":"ระเบิดเพลิงขวด","maxLevel":10,"kind":"active","desc":"ขว้างขวดระเบิดลงพื้น เกิดพื้นไฟวงรัศมี 2 ช่องนาน 5 วินาที ศัตรูที่ยืนในวงโดนไฟเผาทุก 1 วินาที (ดาเมจมาจากพื้นไฟ ไม่ใช่ตัวขวด) Lv.10 รวม 1500...","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"ignite","name":"Ignite","thai":"เพลิงลาม","desc":"ศัตรูที่โดนติดไฟ เผาไหม้ 30% ของดาเมจต่อวิ 3 วิ"}]},{"lv":12,"opts":[{"id":"vortex","name":"Vortex","thai":"วังวน","desc":"ดูดศัตรูในพื้นที่เข้าหากลางวง 1.5 ช่องก่อนโดน"},{"id":"epicenter","name":"Epicenter","thai":"จุดศูนย์กลาง","desc":"ศัตรูกลางวง 1 ช่องรับดาเมจ +184%"},{"id":"concussive","name":"Concussive","thai":"แรงกระแทก","desc":"ศัตรูที่โดนช้าลง 28% 3 วิ"}]},{"lv":15,"opts":[{"id":"one-strike","name":"One Strike","thai":"รวมพลัง","desc":"ทุกครั้งรวมเป็นครั้งเดียว แรงเท่ารวมกัน ดาเมจ +10%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"overkill","name":"Overkill","thai":"ดาเมจล้น","desc":"ดาเมจที่เกินตอนฆ่า 167% ไหลไปศัตรูใกล้สุดใน 5 ช่อง"}]}]},
    {"id":"potion-pitcher","name":"Potion Toss","thai":"ขว้างยา","maxLevel":10,"kind":"active","req":"ขวดกรดกัดเกราะ Lv.1","prereq":[{"skill":"acid-terror","level":1}],"desc":"ขว้าง White Potion ใส่ตัวเองหรือพันธมิตร ฟื้น HP 5 เท่าของยา (ใช้ White Potion 1 ขวดต่อครั้ง)","facetsPending":true},
    {"id":"chemical-protection","name":"Alchemic Coating","thai":"เคลือบสารป้องกัน","maxLevel":10,"kind":"active","req":"ขว้างยา Lv.3","prereq":[{"skill":"potion-pitcher","level":3}],"desc":"เคลือบสารเคมีบนชุดเกราะ เพิ่มพลังป้องกันกายภาพและเวท","facetsPending":true},
    {"id":"alchemy-mastery","name":"Alchemy Mastery","thai":"ปรมาจารย์การปรุงยา","maxLevel":10,"kind":"passive","desc":"ชำนาญการปรุงยา สกิลโจมตีที่ใช้ขวดยา (Acid Flask, Firebomb) แรงขึ้น 3% ต่อเลเวล (Lv.10 +30%)"},
    {"id":"berserk-elixir","name":"Berserk Elixir","thai":"ยาคลั่ง","maxLevel":5,"kind":"active","req":"ขว้างยา Lv.3","prereq":[{"skill":"potion-pitcher","level":3}],"desc":"ดื่มเองหรือขว้างให้เพื่อน: ความเสียหายระยะไกล +3% และความเร็วโจมตี +4% ต่อเลเวล (Lv.5 ความเสียหายระยะไกล +15% ความเร็วโจมตี +20%) นาน 30 วิน..."},
    {"id":"flask-frenzy","name":"Flask Frenzy","thai":"เมายา","maxLevel":10,"kind":"passive","req":"ขวดกรดกัดเกราะ Lv.5","prereq":[{"skill":"acid-terror","level":5}],"desc":"ติดตัว: ปา Acid Flask มีโอกาสออกสองลูก 2% ต่อเลเวล (Lv.10 20%) หรือสามลูก 1% ต่อเลเวล (Lv.10 10%) ในการกดครั้งเดียว"}
  ], "assassin": [
    {"id":"katar-mastery","name":"Katar Edge","thai":"ชำนาญคาตาร์","maxLevel":10,"kind":"passive","desc":"เพิ่มพลังโจมตีเมื่อใช้คาตาร์"},
    {"id":"righthand-mastery","name":"Main-Hand Finesse","thai":"ชำนาญมือขวา","maxLevel":5,"kind":"passive","desc":"ถืออาวุธสองมือ: ดาเมจมือขวาจาก 50% เป็น 60 / 70 / 80 / 90 / 100% (Lv1-5) ไม่มีผลกับ Katar และสกิล"},
    {"id":"lefthand-mastery","name":"Off-Hand Finesse","thai":"ชำนาญมือซ้าย","maxLevel":5,"kind":"passive","req":"ชำนาญมือขวา Lv.2","prereq":[{"skill":"righthand-mastery","level":2}],"desc":"ถืออาวุธสองมือ: ดาเมจมือซ้ายจาก 30% เป็น 40 / 50 / 60 / 70 / 80% (Lv1-5) ไม่มีผลกับ Katar และสกิล"},
    {"id":"sonic-blow","name":"Shadow Fang","thai":"ฟันเสียงสะท้าน","maxLevel":10,"kind":"active","req":"ชำนาญคาตาร์ Lv.4","prereq":[{"skill":"katar-mastery","level":4}],"desc":"ฟันรัวแปดครั้งในพริบตา มีโอกาสทำให้มึนงง","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"crushing-blow","name":"Crushing Blow","thai":"ทุบสะท้าน","desc":"โอกาส 14% มึน 1.5 วิ"}]},{"lv":12,"opts":[{"id":"lingering","name":"Lingering","thai":"สถานะยืดเยื้อ","desc":"เวลาสถานะที่สกิลทำ +56%"},{"id":"cleave","name":"Cleave","thai":"ฟันกวาด","desc":"ศัตรูรอบเป้าในระยะ 1 ช่อง โดน 82% ของดาเมจสกิลด้วย (ใช้กับสกิลเป้าเดียว)"},{"id":"executioner","name":"Executioner","thai":"เพชฌฆาต","desc":"ดาเมจ +566% กับเป้าที่เลือดต่ำกว่า 30%"}]},{"lv":15,"opts":[{"id":"one-strike","name":"One Strike","thai":"รวมพลัง","desc":"ทุกครั้งรวมเป็นครั้งเดียว แรงเท่ารวมกัน ดาเมจ +10%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"overkill","name":"Overkill","thai":"ดาเมจล้น","desc":"ดาเมจที่เกินตอนฆ่า 167% ไหลไปศัตรูใกล้สุดใน 5 ช่อง"}]}]},
    {"id":"sonic-acceleration","name":"Swift Fang","thai":"เร่งโซนิค","maxLevel":5,"kind":"passive","req":"ฟันเสียงสะท้าน Lv.5","prereq":[{"skill":"sonic-blow","level":5}],"desc":"เพิ่มความเสียหายของ Shadow Fang เลเวลละ 20% (Lv.5 = +100%)"},
    {"id":"cloaking","name":"Shadow Walk","thai":"เดินในเงา","maxLevel":5,"kind":"toggle","req":"ซ่อนตัว Lv.2","prereq":[{"skill":"hiding","level":2}],"desc":"หายตัวแบบ Vanish แต่ยังเดินได้ช้าลง (Lv1 36% ถึง Lv5 60% ของความเร็วปกติ) มอนเลิกไล่ เสีย SP ต่อเนื่อง ใช้ Reaper's Bite ได้ระหว่างหายตัว"},
    {"id":"grimtooth","name":"Reaper's Bite","thai":"เขี้ยวเงา","maxLevel":10,"kind":"active","req":"ฟันเสียงสะท้าน Lv.5, ซ่อนตัว Lv.2","prereq":[{"skill":"sonic-blow","level":5},{"skill":"hiding","level":2}],"desc":"แทงใบมีดเงาผุดขึ้นจากพื้นใต้เป้าหมาย โดนศัตรูรอบข้าง ใช้ได้ตอนซ่อนตัว (Vanish / Shadow Walk) เท่านั้น และไม่หลุดจากการซ่อนตัว","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"crushing-blow","name":"Crushing Blow","thai":"ทุบสะท้าน","desc":"โอกาส 14% มึน 1.5 วิ"}]},{"lv":12,"opts":[{"id":"executioner","name":"Executioner","thai":"เพชฌฆาต","desc":"ดาเมจ +566% กับเป้าที่เลือดต่ำกว่า 30%"},{"id":"concussive","name":"Concussive","thai":"แรงกระแทก","desc":"ศัตรูที่โดนช้าลง 28% 3 วิ"},{"id":"cleave","name":"Cleave","thai":"ฟันกวาด","desc":"ศัตรูรอบเป้าในระยะ 1 ช่อง โดน 82% ของดาเมจสกิลด้วย (ใช้กับสกิลเป้าเดียว)"}]},{"lv":15,"opts":[{"id":"overload","name":"Overload","thai":"ทุ่มสุดตัว","desc":"ดาเมจ +60% แต่คูลดาวน์ +50%"},{"id":"wider","name":"Vast","thai":"กว้างไกล","desc":"พื้นที่ +2 ช่อง แต่ดาเมจ -15%"},{"id":"aftershock","name":"Aftershock","thai":"แรงสั่นสะเทือน","desc":"พื้นสั่นซ้ำหลัง 1 วิ ทุกตัวในพื้นที่โดน 216% ของดาเมจสกิล"}]}]},
    {"id":"enchant-poison","name":"Venom Coat","thai":"อาบยาพิษ","maxLevel":10,"kind":"active","req":"จู่โจมพิษ Lv.1","prereq":[{"skill":"envenom","level":1}],"desc":"อาบยาพิษบนอาวุธ การโจมตีปกติกลายเป็นธาตุพิษ (ใช้กับตัวเองหรือเพื่อนในปาร์ตี้เท่านั้น)"},
    {"id":"venom-dust","name":"Toxic Cloud","thai":"ผงพิษ","maxLevel":10,"kind":"active","req":"อาบยาพิษ Lv.5","prereq":[{"skill":"enchant-poison","level":5}],"desc":"โปรยผงพิษลงพื้น มอนในวงโดนดาเมจพิษและมีโอกาสติดพิษ","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"venom","name":"Venom","thai":"พิษร้าย","desc":"โอกาส 12% ติดพิษ 4 วิ"}]},{"lv":12,"opts":[{"id":"concussive","name":"Concussive","thai":"แรงกระแทก","desc":"ศัตรูที่โดนช้าลง 28% 3 วิ"},{"id":"lingering","name":"Lingering","thai":"สถานะยืดเยื้อ","desc":"เวลาสถานะที่สกิลทำ +56%"},{"id":"aftershock","name":"Aftershock","thai":"แรงสั่นสะเทือน","desc":"พื้นสั่นซ้ำหลัง 1 วิ ทุกตัวในพื้นที่โดน 189% ของดาเมจสกิล"}]},{"lv":15,"opts":[{"id":"overload","name":"Overload","thai":"ทุ่มสุดตัว","desc":"ดาเมจ +60% แต่คูลดาวน์ +50%"},{"id":"wider","name":"Vast","thai":"กว้างไกล","desc":"พื้นที่ +2 ช่อง แต่ดาเมจ -15%"},{"id":"epicenter","name":"Epicenter","thai":"จุดศูนย์กลาง","desc":"ศัตรูกลางวง 1 ช่องรับดาเมจ +217%"}]}]}
  ], "rogue": [
    {"id":"plagiarism","name":"Mimicry","thai":"ลอกเลียน","maxLevel":10,"kind":"passive","desc":"ติดตัว: ความเร็วโจมตี +1% ต่อเลเวล · วางบนแถบปุ่มลัด เลือกผู้เล่นใกล้ๆ แล้วกด (หรือคลิกขวาผู้เล่น → ลอกเลียนสกิล) แล้วเลือก 1 สกิลกดใช้ของอา..."},
    {"id":"back-stab","name":"Blink Stab","thai":"แทงข้างหลัง","maxLevel":10,"kind":"active","req":"ขโมย Lv.4","prereq":[{"skill":"steal","level":4}],"desc":"พุ่งไปโผล่ด้านหลังศัตรูแล้วแทงจุดตาย ดาเมจสูง","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"crushing-blow","name":"Crushing Blow","thai":"ทุบสะท้าน","desc":"โอกาส 14% มึน 1.5 วิ"}]},{"lv":12,"opts":[{"id":"cleave","name":"Cleave","thai":"ฟันกวาด","desc":"ศัตรูรอบเป้าในระยะ 1 ช่อง โดน 82% ของดาเมจสกิลด้วย (ใช้กับสกิลเป้าเดียว)"},{"id":"executioner","name":"Executioner","thai":"เพชฌฆาต","desc":"ดาเมจ +566% กับเป้าที่เลือดต่ำกว่า 30%"},{"id":"overheat","name":"Overheat","thai":"ทุ่มแรง","desc":"ดาเมจ +35% แต่คูลดาวน์ +40%"}]},{"lv":15,"opts":[{"id":"overload","name":"Overload","thai":"ทุ่มสุดตัว","desc":"ดาเมจ +60% แต่คูลดาวน์ +50%"},{"id":"barrage","name":"Barrage","thai":"ระดมโจมตี","desc":"โดนเพิ่ม 3 ครั้ง แต่ละครั้งดาเมจ -25%"},{"id":"overkill","name":"Overkill","thai":"ดาเมจล้น","desc":"ดาเมจที่เกินตอนฆ่า 167% ไหลไปศัตรูใกล้สุดใน 5 ช่อง"}]}]},
    {"id":"raid","name":"Ambush","thai":"จู่โจมจากเงา","maxLevel":10,"kind":"active","req":"แทงข้างหลัง Lv.2, ซ่อนตัว Lv.3","prereq":[{"skill":"back-stab","level":2},{"skill":"hiding","level":3}],"desc":"โผล่จากเงาฟันศัตรูรอบตัว มีโอกาสทำให้มึนงง","facets":[{"lv":5,"opts":[{"id":"power","name":"Power","thai":"พลังทำลาย","desc":"ดาเมจ +20%"},{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"concussive","name":"Concussive","thai":"แรงกระแทก","desc":"ศัตรูที่โดนช้าลง 18% 3 วิ"}]},{"lv":12,"opts":[{"id":"epicenter","name":"Epicenter","thai":"จุดศูนย์กลาง","desc":"ศัตรูกลางวง 1 ช่องรับดาเมจ +184%"},{"id":"lingering","name":"Lingering","thai":"สถานะยืดเยื้อ","desc":"เวลาสถานะที่สกิลทำ +56%"},{"id":"aftershock","name":"Aftershock","thai":"แรงสั่นสะเทือน","desc":"พื้นสั่นซ้ำหลัง 1 วิ ทุกตัวในพื้นที่โดน 189% ของดาเมจสกิล"}]},{"lv":15,"opts":[{"id":"overload","name":"Overload","thai":"ทุ่มสุดตัว","desc":"ดาเมจ +60% แต่คูลดาวน์ +50%"},{"id":"wider","name":"Vast","thai":"กว้างไกล","desc":"พื้นที่ +2 ช่อง แต่ดาเมจ -15%"},{"id":"detonate","name":"Detonate","thai":"ระเบิดศพ","desc":"ศัตรูที่ตายจากสกิลนี้ระเบิด ทำดาเมจ 90% ของ HP สูงสุดของตัวที่ตาย ใส่ศัตรูรอบ 5 ช่อง (ไม่เกิน 3 เท่าของดาเมจที่ฆ่า) ตัวที่ตายจากแรงระเบิดจะระเบิดต่ออีก 1 ทอด"}]}]},
    {"id":"strip-armor","name":"Armor Break","thai":"ปลดเกราะ","maxLevel":10,"kind":"active","req":"ขโมย Lv.3","prereq":[{"skill":"steal","level":3}],"desc":"ปลดเกราะของเป้าหมาย ลดพลังป้องกันอย่างมาก","facets":[{"lv":3,"opts":[{"id":"quick","name":"Quick Cast","thai":"ร่ายว่องไว","desc":"เวลาร่าย -30%, คูลดาวน์ -20%"},{"id":"focus","name":"Focus","thai":"สมาธิ","desc":"SP -35%"},{"id":"deep-curse","name":"Deep Curse","thai":"คำสาปลึก","desc":"ค่าที่ดีบัฟของสกิลนี้ลด (DEF / ATK / ความเร็ว ฯลฯ) แรงขึ้น 10%"}]},{"lv":6,"opts":[{"id":"contagion","name":"Contagion","thai":"ดีบัฟลาม","desc":"ดีบัฟของสกิลนี้ลามไปมอนรอบเป้า 2 ช่อง 55% ของความแรงและเวลา (สูงสุด 3 ตัว ไม่รวมบอส ไม่ลามต่อ)"},{"id":"exploit","name":"Exploit","thai":"ซ้ำเติม","desc":"มอนที่ติดสถานะ / ดีบัฟจากสกิลนี้รับดาเมจจากทุกคนเพิ่ม 8% (บอสครึ่งหนึ่ง)"},{"id":"sure-status","name":"Sure Status","thai":"ติดแน่น","desc":"โอกาสติดสถานะของสกิลนี้ +12% (ไม่ใช่สกิลโจมตี); ดีบัฟที่ติดแน่นอนอยู่แล้ว (Strip Armor, Provoke, Quagmire) อยู่นานขึ้น 12% แทน"}]},{"lv":10,"opts":[{"id":"lingering","name":"Lingering","thai":"สถานะยืดเยื้อ","desc":"เวลาสถานะที่สกิลทำ +70%"},{"id":"master","name":"Master","thai":"ชำนาญ","desc":"คูลดาวน์ -50%, เวลาร่าย -50%"},{"id":"free","name":"Effortless","thai":"ไร้แรง","desc":"SP -70%"}]}]},
    {"id":"snatcher","name":"Snatch Strike","thai":"ฉกชิง","maxLevel":10,"kind":"passive","req":"ขโมย Lv.5","prereq":[{"skill":"steal","level":5}],"desc":"ติดตัว: โจมตีปกติที่โดนมอน มีโอกาส 1% ต่อเลเวล (Lv.10 = 10%) ขโมยไอเทมจากมอนตัวนั้น (ขโมยได้ครั้งเดียวต่อมอน ไม่ได้กับบอส)"}
  ] };

let currentSkillBuilderTab = 'novice';
let skillBuilderSnapshot = null;
let skillBuilderNotice = '';

// 1. Update Class 1 and Class 2 Dropdowns in Plan Editor
function updateClassDropdownsInEditor() {
  const c1Sel = document.getElementById("plan-editor-class1");
  const c2Sel = document.getElementById("plan-editor-class2");
  if (!c1Sel || !c2Sel || !activeEditingPlan) return;

  const currentC1 = activeEditingPlan.class1Target || 'archer';
  c1Sel.value = currentC1;
  const j1 = document.getElementById("plan-editor-class1-job");
  const j2 = document.getElementById("plan-editor-class2-job");
  if (j1) j1.value = activeEditingPlan.class1JobLevel || 10;
  if (j2) j2.value = activeEditingPlan.class2JobLevel || 50;
  const autoCb = document.getElementById("plan-editor-autojob");
  if (autoCb) {
    autoCb.checked = planAutoJobChangeOf(activeEditingPlan);
    autoCb.onchange = () => {
      activeEditingPlan.autoJobChange = autoCb.checked;
      if (typeof markPlanDirty === 'function') markPlanDirty();
      refreshAutoJobUi();
    };
  }
  refreshAutoJobUi();
  const petCb = document.getElementById("plan-editor-eventpet");
  if (petCb) {
    petCb.checked = activeEditingPlan.eventPet !== false;
    petCb.onchange = () => {
      activeEditingPlan.eventPet = petCb.checked;
      if (typeof markPlanDirty === 'function') markPlanDirty();
    };
  }
  const gemCb = document.getElementById("plan-editor-autogem");
  if (gemCb) {
    gemCb.checked = activeEditingPlan.autoUpgradeGems !== false;
    gemCb.onchange = () => {
      activeEditingPlan.autoUpgradeGems = gemCb.checked;
      if (typeof markPlanDirty === 'function') markPlanDirty();
    };
  }

  const tree = CLASS_TREE_MAP[currentC1] || CLASS_TREE_MAP['archer'];
  c2Sel.innerHTML = tree.secondClasses.map(sc => `
    <option value="${sc.id}">${sc.name}</option>
  `).join('');

  if (activeEditingPlan.class2Target && tree.secondClasses.some(sc => sc.id === activeEditingPlan.class2Target)) {
    c2Sel.value = activeEditingPlan.class2Target;
  } else {
    activeEditingPlan.class2Target = tree.secondClasses[0].id;
    c2Sel.value = activeEditingPlan.class2Target;
  }

  c1Sel.onchange = () => {
    activeEditingPlan.class1Target = c1Sel.value;
    const newTree = CLASS_TREE_MAP[c1Sel.value] || CLASS_TREE_MAP['archer'];
    c2Sel.innerHTML = newTree.secondClasses.map(sc => `
      <option value="${sc.id}">${sc.name}</option>
    `).join('');
    activeEditingPlan.class2Target = newTree.secondClasses[0].id;
    c2Sel.value = activeEditingPlan.class2Target;
    updatePlanEditorBadges();
  };

  c2Sel.onchange = () => {
    activeEditingPlan.class2Target = c2Sel.value;
    updatePlanEditorBadges();
  };
}

// 2. Update Plan Editor Badges (Skill count and Stat summary)
function countPlannedFacets(plan) {
  const facets = plan && plan.skillBuild && plan.skillBuild.facets;
  if (!facets || typeof facets !== 'object') return 0;
  const c1 = plan.class1Target || 'archer';
  const c2 = plan.class2Target || 'hunter';
  const allowed = new Set(['novice', c1, c2]);
  let total = 0;
  for (const [sId, arr] of Object.entries(facets)) {
    if (!Array.isArray(arr)) continue;
    const m = getSkillMeta(sId);
    if (m && !allowed.has(m.tier)) continue;
    arr.forEach(v => { if (typeof v === 'number' && v >= 0) total++; });
  }
  return total;
}

function updatePlanEditorBadges() {
  if (!activeEditingPlan) return;
  if (typeof window.updateGearBadge === 'function') window.updateGearBadge();
  const skillBadge = document.getElementById("plan-skill-count-badge");
  const statBadge = document.getElementById("plan-stat-summary-badge");

  if (skillBadge) {
    const queue = activeEditingPlan.skillBuild?.skillPointQueue || [];
    const facetCount = countPlannedFacets(activeEditingPlan);
    skillBadge.innerText = facetCount > 0 ? `${queue.length} แต้ม · ✨${facetCount}` : `${queue.length} แต้ม`;
    skillBadge.style.background = (queue.length > 0 || facetCount > 0) ? 'rgba(168, 85, 247, 0.4)' : 'rgba(168, 85, 247, 0.2)';
  }

  if (statBadge) {
    const q = statQueueOf(activeEditingPlan.statBuild);
    if (q.length) {
      const sb = statFinal(q);
      const top = STAT_KEYS.filter(k => sb[k] > 1).sort((x, y) => sb[y] - sb[x]).slice(0, 2);
      statBadge.innerText = `${q.length} ขั้น · ${top.map(k => `${k} ${sb[k]}`).join(' / ')}`;
      statBadge.style.background = 'rgba(56, 189, 248, 0.4)';
    } else {
      statBadge.innerText = 'Default';
      statBadge.style.background = 'rgba(56, 189, 248, 0.2)';
    }
  }
}

// 3. Open Skill Builder Modal
function openSkillBuilderModal() {
  if (!activeEditingPlan) return;
  if (!activeEditingPlan.skillBuild) {
    activeEditingPlan.skillBuild = { skillPointQueue: [], plannedLevels: {}, facets: {} };
  }
  if (!Array.isArray(activeEditingPlan.skillBuild.skillPointQueue)) {
    activeEditingPlan.skillBuild.skillPointQueue = [];
  }
  if (!activeEditingPlan.skillBuild.plannedLevels) {
    activeEditingPlan.skillBuild.plannedLevels = {};
  }
  if (!activeEditingPlan.skillBuild.facets || typeof activeEditingPlan.skillBuild.facets !== 'object') {
    activeEditingPlan.skillBuild.facets = {};
  }

  // Update Tab Names
  const c1NameEl = document.getElementById("skill-tab-class1-name");
  const c2NameEl = document.getElementById("skill-tab-class2-name");
  const c1 = activeEditingPlan.class1Target || 'archer';
  const c2 = activeEditingPlan.class2Target || 'hunter';

  if (c1NameEl) c1NameEl.innerText = (CLASS_TREE_MAP[c1]?.name || c1).split(' ')[0];
  if (c2NameEl) {
    const tree = CLASS_TREE_MAP[c1];
    const sc = tree?.secondClasses.find(s => s.id === c2);
    c2NameEl.innerText = (sc?.name || c2).split(' ')[0];
  }

  skillBuilderSnapshot = JSON.stringify(activeEditingPlan.skillBuild);
  const before = activeEditingPlan.skillBuild.skillPointQueue;
  const fixed = repairSkillQueue(before, true);
  applySkillQueue(fixed.queue);
  const notes = [];
  if (fixed.added.length) notes.push(`เติมสกิลเงื่อนไขที่ขาดให้: ${summarizeSkillIds(fixed.added)}`);
  if (fixed.dropped.length) notes.push(`ตัดแต้มที่อัปไม่ได้ออก: ${summarizeSkillIds(fixed.dropped)}`);
  if (!notes.length && fixed.queue.join() !== before.join()) notes.push('จัดลำดับใหม่ให้สกิลเงื่อนไขมาก่อน');
  skillBuilderNotice = notes.length ? `🔧 ปรับคิวเดิมให้ตรงเงื่อนไขของเกมแล้ว — ${notes.join(' · ')} (กด "ยกเลิก" เพื่อไม่ใช้การปรับนี้)` : '';

  currentSkillBuilderTab = 'novice';
  renderSkillBuilderUI();

  const modal = document.getElementById("skill-builder-modal");
  if (modal) modal.style.display = 'flex';
}

// 4. Render Skill Builder UI
function renderSkillBuilderUI() {
  if (!activeEditingPlan || !activeEditingPlan.skillBuild) return;

  const queue = activeEditingPlan.skillBuild.skillPointQueue || [];
  const planned = activeEditingPlan.skillBuild.plannedLevels || {};
  const c1 = activeEditingPlan.class1Target || 'archer';
  const c2 = activeEditingPlan.class2Target || 'hunter';

  // Calculate points spent per tier
  const noviceSkills = SKILLS_DATABASE.novice || [];
  const class1Skills = SKILLS_DATABASE[c1] || [];
  const class2Skills = SKILLS_DATABASE[c2] || [];

  const noviceSpent = queue.filter(id => noviceSkills.some(s => s.id === id)).length;
  const class1Spent = queue.filter(id => class1Skills.some(s => s.id === id)).length;
  const class2Spent = queue.filter(id => class2Skills.some(s => s.id === id)).length;

  // Update budget badges
  const bNov = document.getElementById("skill-budget-novice");
  const bC1 = document.getElementById("skill-budget-class1");
  const bC2 = document.getElementById("skill-budget-class2");

  if (bNov) {
    bNov.innerText = `${noviceSpent} / 9 แต้ม`;
    bNov.style.color = noviceSpent >= 9 ? '#4ade80' : '#38bdf8';
  }
  if (bC1) {
    bC1.innerText = `${class1Spent} / 49 แต้ม`;
    bC1.style.color = class1Spent >= 49 ? '#4ade80' : '#c084fc';
  }
  if (bC2) {
    bC2.innerText = `${class2Spent} / 49 แต้ม`;
    bC2.style.color = class2Spent >= 49 ? '#4ade80' : '#facc15';
  }

  // Update Tabs Active State
  document.querySelectorAll('.skill-tab-btn').forEach(btn => {
    const tab = btn.getAttribute('data-tab');
    if (tab === currentSkillBuilderTab) {
      btn.className = 'btn btn-primary btn-sm skill-tab-btn';
    } else {
      btn.className = 'btn btn-secondary btn-sm skill-tab-btn';
    }
  });

  // Get active skills list
  let activeList = [];
  let tierMaxBudget = 49;
  let tierSpent = 0;
  if (currentSkillBuilderTab === 'novice') {
    activeList = noviceSkills;
    tierMaxBudget = 9;
    tierSpent = noviceSpent;
  } else if (currentSkillBuilderTab === 'class1') {
    activeList = class1Skills;
    tierMaxBudget = 49;
    tierSpent = class1Spent;
  } else {
    activeList = class2Skills;
    tierMaxBudget = 49;
    tierSpent = class2Spent;
  }

  const grid = document.getElementById("skill-cards-grid");
  if (grid) {
    let notice = document.getElementById('skill-builder-notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'skill-builder-notice';
      notice.className = 'skill-notice';
      grid.parentNode.insertBefore(notice, grid);
    }
    notice.textContent = skillBuilderNotice;
    notice.style.display = skillBuilderNotice ? '' : 'none';
  }
  if (grid) {
    grid.innerHTML = activeList.map(skill => {
      const curLv = planned[skill.id] || 0;
      const isMaxed = curLv >= skill.maxLevel;
      const preview = isMaxed ? { ok: false, why: 'max' } : skillAddPreview(skill.id);
      const canAdd = preview.ok;
      const canMinus = curLv > 0;
      const plusTitle = canAdd
        ? (preview.added.length ? `+1 แต้ม — จะอัป ${summarizeSkillIds(preview.added)} ให้ก่อนอัตโนมัติ (ใช้ทั้งหมด ${preview.cost} แต้ม)` : '+1 แต้ม')
        : (preview.why === 'max' ? 'สกิลเต็มแล้ว' : preview.why === 'budget' ? 'แต้มของสายนี้ไม่พอ (รวมสกิลเงื่อนไข)' : 'อัปไม่ได้');
      const reqHtml = (skill.prereq || []).map(p => {
        const met = (planned[p.skill] || 0) >= p.level;
        return `<span class="skill-req ${met ? 'met' : ''}">${met ? '✔' : '🔒'} ${escapeHTML(skillMetaName(p.skill))} Lv.${p.level}</span>`;
      }).join('');

      // Find all step indexes in queue where this skill was picked
      const stepIndexes = [];
      queue.forEach((sId, idx) => {
        if (sId === skill.id) stepIndexes.push(idx + 1);
      });

      const iconUrl = `https://www.aetheria-online.in.th/art/icons/skills/${skill.icon || skill.id}.webp`;
      const curFacets = (activeEditingPlan.skillBuild.facets && Array.isArray(activeEditingPlan.skillBuild.facets[skill.id]))
        ? activeEditingPlan.skillBuild.facets[skill.id]
        : [-1, -1, -1];
      let facetsHtml = '';
      if (Array.isArray(skill.facets) && skill.facets.length > 0) {
        const tiersHtml = skill.facets.map((tier, tIdx) => {
          const opts = Array.isArray(tier.opts) ? tier.opts : [];
          const pickedIdx = (typeof curFacets[tIdx] === 'number' && curFacets[tIdx] >= 0 && curFacets[tIdx] < opts.length) ? curFacets[tIdx] : -1;
          const pickedOpt = pickedIdx >= 0 ? opts[pickedIdx] : null;
          const needsBonus = tier.lv > skill.maxLevel;
          const isTierMet = curLv >= tier.lv;
          const lvTip = needsBonus
            ? `ปลดล็อกที่ Lv.${tier.lv} (ใช้เลเวลสกิล + โบนัสจากอุปกรณ์/ศิลาปลุกพลัง)`
            : `ปลดล็อกเมื่ออัปสกิลถึง Lv.${tier.lv}`;
          return `
            <div class="skill-facet-tier ${pickedIdx >= 0 ? 'has-pick' : ''}">
              <div class="skill-facet-tier-head">
                <span class="skill-facet-lv ${isTierMet ? 'met' : needsBonus ? 'bonus' : ''}" title="${escapeHTML(lvTip)}">Lv.${tier.lv}${needsBonus ? '+' : ''}</span>
                <div class="skill-facet-opts">
                  ${opts.map((opt, oIdx) => {
                    const isOn = pickedIdx === oIdx;
                    const tip = `${opt.thai || opt.name} (${opt.name}) — ${opt.desc || ''}`;
                    return `<button type="button" class="skill-facet-btn ${isOn ? 'on' : ''}" onclick="toggleSkillFacet('${skill.id}', ${tIdx}, ${oIdx})" title="${escapeHTML(tip)}">${escapeHTML(opt.thai || opt.name)}</button>`;
                  }).join('')}
                </div>
              </div>
              ${pickedOpt ? `<div class="skill-facet-desc">✨ <b>${escapeHTML(pickedOpt.thai || pickedOpt.name)}:</b> ${escapeHTML(pickedOpt.desc || '')}</div>` : ''}
            </div>
          `;
        }).join('');
        facetsHtml = `
          <div class="skill-facets-box">
            <div class="skill-facets-header">
              <span>✨ ปลุกพลังสกิล (Awakening)</span>
              <span class="skill-facets-sub">เลือก 1 สาย/ขั้น</span>
            </div>
            ${tiersHtml}
          </div>
        `;
      } else if (skill.facetsPending) {
        facetsHtml = `<div class="skill-facets-pending">✨ ปลุกพลังสกิล: รอดำเนินการในเกม</div>`;
      }

      return `
        <div class="skill-builder-card ${curLv > 0 ? 'is-allocated' : ''} ${isMaxed ? 'is-maxed' : ''}" title="${escapeHTML(skill.desc || '')}">
          <div class="skill-card-top">
            <img src="${iconUrl}" class="skill-card-icon" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'38\\' height=\\'38\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%231e293b\\'/><text x=\\'50%\\' y=\\'55%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' fill=\\'%23a855f7\\' font-size=\\'18\\'>⚡</text></svg>';">
            <div class="skill-card-info">
              <div class="skill-card-title">${escapeHTML(skill.name)}</div>
              <div class="skill-card-subtitle">
                <span>${escapeHTML(skill.thai)}</span>
                <span class="skill-kind ${skill.kind}">${skill.kind === 'passive' ? 'Passive' : skill.kind === 'toggle' ? 'Toggle' : 'Active'}</span>
              </div>
            </div>
          </div>

          ${reqHtml ? `<div class="skill-req-row">ต้องมี: ${reqHtml}</div>` : ''}

          ${skill.kind !== 'passive' ? `
          <button type="button" class="skill-auto-toggle ${isSkillAutoOn(skill.id) ? 'on' : 'off'}" onclick="toggleSkillAuto('${skill.id}')"
            title="${isSkillAutoOn(skill.id) ? 'บอทจะติ๊กสกิลนี้ใน AUTO ของเกม (กดเพื่อปิด)' : 'บอทจะไม่ใช้สกิลนี้ใน AUTO (กดเพื่อเปิด)'}">
            <span class="sat-switch"></span> ${isSkillAutoOn(skill.id) ? 'ใช้ใน AUTO' : 'ไม่ใช้ใน AUTO'}
          </button>` : ''}

          <div class="skill-card-controls">
            <div class="skill-level-indicator ${isMaxed ? 'maxed' : ''}">
              Lv. ${curLv} / ${skill.maxLevel}
            </div>
            <div class="skill-btn-group">
              <button type="button" class="btn-skill-adjust" onclick="removeSkillPoint('${skill.id}')" ${!canMinus ? 'disabled' : ''}>-</button>
              <button type="button" class="btn-skill-adjust btn-plus" onclick="addSkillPoint('${skill.id}')" ${!canAdd ? 'disabled' : ''} title="${escapeHTML(plusTitle)}">+</button>
            </div>
          </div>

          ${facetsHtml}

          ${stepIndexes.length > 0 ? `
            <div style="display: flex; gap: 3px; flex-wrap: wrap; margin-top: 2px;">
              ${stepIndexes.map(st => `<span class="badge" style="background: rgba(168, 85, 247, 0.25); color: #d8b4fe; font-size: 9px; padding: 0 4px;">#${st}</span>`).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  // Render Queue Chips
  const qContainer = document.getElementById("skill-queue-chips-container");
  const qTotal = document.getElementById("skill-queue-total-count");
  if (qTotal) qTotal.innerText = queue.length;

  if (qContainer) {
    if (queue.length === 0) {
      qContainer.innerHTML = '<span style="font-size: 11px; color: #64748b; font-style: italic;">ยังไม่มีแต้มสกิลในคิว — คลิกปุ่ม + ที่สกิลด้านบนเพื่อเริ่มบันทึกลำดับ</span>';
    } else {
      const badSteps = findQueuePrereqProblems(queue);
      qContainer.innerHTML = queue.map((sId, idx) => {
        let skillMeta = null;
        for (const k in SKILLS_DATABASE) {
          const found = SKILLS_DATABASE[k].find(s => s.id === sId);
          if (found) { skillMeta = found; break; }
        }
        const sName = skillMeta ? (skillMeta.thai || skillMeta.name) : sId;
        return `
          <span class="skill-queue-chip ${badSteps.has(idx) ? 'bad' : ''}" title="ลำดับที่ ${idx + 1}: ${sName}${badSteps.has(idx) ? ' — ยังไม่ผ่านเงื่อนไขสกิลก่อนหน้า ณ จุดนี้ (บอทจะข้ามไปก่อนจนกว่าจะผ่าน)' : ''}">
            <span class="chip-step">#${idx + 1}</span>
            <span class="chip-name">${escapeHTML(sName)}</span>
            <span class="chip-del" onclick="removeSkillPointAtIndex(${idx})">&times;</span>
          </span>
        `;
      }).join('');
    }
  }
}

// 5. Skill rules: every change goes through repairSkillQueue so the queue always matches the game
//    (prerequisites before the skill, max level, 9 / 49 / 49 points per tier, only the plan's classes)
let skillMetaCache = null;
function getSkillMeta(skillId) {
  if (!skillMetaCache) {
    skillMetaCache = {};
    for (const t in SKILLS_DATABASE) SKILLS_DATABASE[t].forEach(s => { skillMetaCache[s.id] = Object.assign({ tier: t }, s); });
  }
  return skillMetaCache[skillId] || null;
}

function skillMetaName(skillId) {
  const m = getSkillMeta(skillId);
  return m ? (m.thai || m.name) : skillId;
}

function planSkillTiers() {
  const c1 = activeEditingPlan?.class1Target || 'archer';
  const c2 = activeEditingPlan?.class2Target || 'hunter';
  return { novice: 9, [c1]: 49, [c2]: 49 };
}

// Rebuild a queue that the game would accept.
//  - a point whose prerequisites come later in the queue is moved to right after them
//  - insertMissing: prerequisites that never appear are inserted just before the point that needs them
//  - anything still impossible (max level, tier full, prerequisite missing, other class) is dropped
function repairSkillQueue(queue, insertMissing) {
  const budgets = planSkillTiers();
  const lv = {}, spent = {};
  const out = [], dropped = [], added = [];

  const prereqMet = m => (m.prereq || []).every(p => (lv[p.skill] || 0) >= p.level);
  const check = id => {
    const m = getSkillMeta(id);
    if (!m || budgets[m.tier] === undefined) return 'class';
    if ((lv[id] || 0) >= m.maxLevel) return 'max';
    if ((spent[m.tier] || 0) >= budgets[m.tier]) return 'budget';
    return prereqMet(m) ? 'ok' : 'prereq';
  };
  const place = id => {
    const m = getSkillMeta(id);
    out.push(id);
    lv[id] = (lv[id] || 0) + 1;
    spent[m.tier] = (spent[m.tier] || 0) + 1;
  };
  // Will the rest of the queue raise every prerequisite high enough by itself?
  const laterSatisfies = (m, rest) => (m.prereq || []).every(p =>
    (lv[p.skill] || 0) + rest.filter(x => x === p.skill).length >= p.level);
  const insertPrereqs = (id, depth) => {
    const m = getSkillMeta(id);
    for (const p of (m.prereq || [])) {
      while ((lv[p.skill] || 0) < p.level) {
        if (depth > 6) return false;
        const pm = getSkillMeta(p.skill);
        if (!pm) return false;
        if (!prereqMet(pm) && !insertPrereqs(p.skill, depth + 1)) return false;
        if (check(p.skill) !== 'ok') return false;
        place(p.skill);
        added.push(p.skill);
      }
    }
    return true;
  };

  const pending = [];
  const flush = () => {
    for (let i = 0; i < pending.length; i++) {
      if (check(pending[i]) === 'ok') { place(pending.splice(i, 1)[0]); i = -1; }
    }
  };

  queue.forEach((id, idx) => {
    const r = check(id);
    if (r === 'ok') { place(id); flush(); return; }
    if (r !== 'prereq') { dropped.push({ id, why: r }); return; }
    const m = getSkillMeta(id);
    if (insertMissing && !laterSatisfies(m, queue.slice(idx + 1))) {
      const snap = { out: out.length, added: added.length, lv: Object.assign({}, lv), spent: Object.assign({}, spent) };
      if (insertPrereqs(id, 0) && check(id) === 'ok') { place(id); flush(); return; }
      out.length = snap.out; added.length = snap.added;
      Object.keys(lv).forEach(k => delete lv[k]); Object.assign(lv, snap.lv);
      Object.keys(spent).forEach(k => delete spent[k]); Object.assign(spent, snap.spent);
    }
    pending.push(id);
  });
  pending.forEach(id => dropped.push({ id, why: check(id) === 'budget' ? 'budget' : 'prereq' }));

  return { queue: out, levels: lv, dropped, added };
}

// "ใช้ใน AUTO" switch on a skill card: switched-off skills are not ticked for the game's AUTO
// (stored as skillBuild.autoOff; everything else stays on, like before)
function isSkillAutoOn(id) {
  const off = activeEditingPlan && activeEditingPlan.skillBuild && activeEditingPlan.skillBuild.autoOff;
  return !(Array.isArray(off) && off.includes(id));
}
function toggleSkillAuto(id) {
  if (!activeEditingPlan || !activeEditingPlan.skillBuild) return;
  const off = new Set(Array.isArray(activeEditingPlan.skillBuild.autoOff) ? activeEditingPlan.skillBuild.autoOff : []);
  if (off.has(id)) off.delete(id); else off.add(id);
  activeEditingPlan.skillBuild.autoOff = Array.from(off);
  renderSkillBuilderUI();
}
window.toggleSkillAuto = toggleSkillAuto;

function toggleSkillFacet(skillId, tierIdx, optIdx) {
  if (!activeEditingPlan || !activeEditingPlan.skillBuild) return;
  if (!activeEditingPlan.skillBuild.facets || typeof activeEditingPlan.skillBuild.facets !== 'object') {
    activeEditingPlan.skillBuild.facets = {};
  }
  const cur = Array.isArray(activeEditingPlan.skillBuild.facets[skillId])
    ? [...activeEditingPlan.skillBuild.facets[skillId]]
    : [-1, -1, -1];
  while (cur.length < 3) cur.push(-1);
  cur[tierIdx] = (cur[tierIdx] === optIdx) ? -1 : optIdx;
  if (cur.every(v => !(typeof v === 'number' && v >= 0))) {
    delete activeEditingPlan.skillBuild.facets[skillId];
  } else {
    activeEditingPlan.skillBuild.facets[skillId] = cur;
  }
  renderSkillBuilderUI();
}
window.toggleSkillFacet = toggleSkillFacet;

function applySkillQueue(newQueue) {
  activeEditingPlan.skillBuild.skillPointQueue = newQueue;
  const levels = {};
  newQueue.forEach(id => { levels[id] = (levels[id] || 0) + 1; });
  activeEditingPlan.skillBuild.plannedLevels = levels;
}

function summarizeSkillIds(list) {
  const count = {};
  list.forEach(x => { const id = x.id || x; count[id] = (count[id] || 0) + 1; });
  return Object.keys(count).map(id => `${skillMetaName(id)} ${count[id]} แต้ม`).join(', ');
}

// Cost of one more point of this skill right now (the point + prerequisites it pulls in), or why it can't be added
function skillAddPreview(skillId) {
  const queue = activeEditingPlan.skillBuild.skillPointQueue;
  const res = repairSkillQueue(queue.concat(skillId), true);
  const ok = res.queue.length > queue.length && !res.dropped.length;
  if (ok) return { ok: true, cost: res.queue.length - queue.length, added: res.added };
  const why = (res.dropped[res.dropped.length - 1] || {}).why;
  return { ok: false, why };
}

function addSkillPoint(skillId, silent = false) {
  if (!activeEditingPlan || !activeEditingPlan.skillBuild) return;
  const queue = activeEditingPlan.skillBuild.skillPointQueue;
  const res = repairSkillQueue(queue.concat(skillId), true);
  if (res.dropped.length || res.queue.length <= queue.length) {
    if (!silent) {
      const why = (res.dropped[res.dropped.length - 1] || {}).why;
      alert(why === 'max' ? 'สกิลนี้เต็มแล้ว'
        : why === 'class' ? 'สกิลนี้ไม่ได้อยู่ในอาชีพของแผนนี้'
        : 'แต้มสกิลของสายนี้ไม่พอ (รวมสกิลเงื่อนไขที่ต้องอัปก่อน)');
    }
    return;
  }
  applySkillQueue(res.queue);
  if (!silent) renderSkillBuilderUI();
}

// Remove one point, then drop/move whatever no longer meets its prerequisites (asks first)
function removeSkillPointsAndRepair(newQueue) {
  const res = repairSkillQueue(newQueue, false);
  if (res.dropped.length) {
    const msg = `การลดแต้มนี้ทำให้สกิลต่อไปนี้ไม่ผ่านเงื่อนไข และจะถูกลบออกด้วย:\n\n${summarizeSkillIds(res.dropped)}\n\nยืนยันหรือไม่?`;
    if (!confirm(msg)) return;
  }
  applySkillQueue(res.queue);
  renderSkillBuilderUI();
}

function removeSkillPoint(skillId) {
  if (!activeEditingPlan || !activeEditingPlan.skillBuild) return;
  const queue = activeEditingPlan.skillBuild.skillPointQueue;
  const lastIdx = queue.lastIndexOf(skillId);
  if (lastIdx === -1) return;
  removeSkillPointsAndRepair(queue.filter((_, i) => i !== lastIdx));
}

function removeSkillPointAtIndex(idx) {
  if (!activeEditingPlan || !activeEditingPlan.skillBuild) return;
  const queue = activeEditingPlan.skillBuild.skillPointQueue;
  if (idx < 0 || idx >= queue.length) return;
  removeSkillPointsAndRepair(queue.filter((_, i) => i !== idx));
}

// Queue positions whose prerequisites aren't met yet at that point
function findQueuePrereqProblems(queue) {
  const lv = {};
  const bad = new Set();
  queue.forEach((id, idx) => {
    const m = getSkillMeta(id);
    if (m && (m.prereq || []).some(p => (lv[p.skill] || 0) < p.level)) bad.add(idx);
    lv[id] = (lv[id] || 0) + 1;
  });
  return bad;
}

function resetSkillQueue() {
  if (!activeEditingPlan || !activeEditingPlan.skillBuild) return;
  const hasFacets = countPlannedFacets(activeEditingPlan) > 0;
  if (activeEditingPlan.skillBuild.skillPointQueue.length === 0 && !hasFacets) return;
  if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการล้างลำดับแต้มสกิลและการตั้งค่าปลุกพลังสกิลทั้งหมด?')) return;

  activeEditingPlan.skillBuild.skillPointQueue = [];
  activeEditingPlan.skillBuild.plannedLevels = {};
  activeEditingPlan.skillBuild.facets = {};
  renderSkillBuilderUI();
}

function applySkillPreset() {
  if (!activeEditingPlan || !activeEditingPlan.skillBuild) return;
  const c1 = activeEditingPlan.class1Target || 'archer';
  const c2 = activeEditingPlan.class2Target || 'hunter';

  activeEditingPlan.skillBuild.skillPointQueue = [];
  activeEditingPlan.skillBuild.plannedLevels = {};
  if (!activeEditingPlan.skillBuild.facets || typeof activeEditingPlan.skillBuild.facets !== 'object') {
    activeEditingPlan.skillBuild.facets = {};
  }

  // 1. Novice: 9x basic-skill
  for (let i = 0; i < 9; i++) {
    addSkillPoint('basic-skill', true);
  }

  // 2. Class 1 Archer preset
  if (c1 === 'archer') {
    for (let i = 0; i < 10; i++) addSkillPoint('owl-eye', true);
    for (let i = 0; i < 10; i++) addSkillPoint('vulture-eye', true);
    for (let i = 0; i < 10; i++) addSkillPoint('double-strafe', true);
    for (let i = 0; i < 10; i++) addSkillPoint('improve-concentration', true);
    for (let i = 0; i < 9; i++) addSkillPoint('arrow-shower', true);
    activeEditingPlan.skillBuild.facets['double-strafe'] = [0, 1, 0];
    activeEditingPlan.skillBuild.facets['arrow-shower'] = [0, 1, 0];
  }

  // 3. Class 2 Hunter preset
  if (c2 === 'hunter') {
    addSkillPoint('falconry-mastery', true);
    for (let i = 0; i < 10; i++) addSkillPoint('blitz-beat', true);
    for (let i = 0; i < 10; i++) addSkillPoint('steel-crow', true);
    for (let i = 0; i < 5; i++) addSkillPoint('auto-blitz-beat', true);
    for (let i = 0; i < 10; i++) addSkillPoint('land-mine', true);
    for (let i = 0; i < 10; i++) addSkillPoint('ankle-snare', true);
    for (let i = 0; i < 3; i++) addSkillPoint('claymore-trap', true);
    activeEditingPlan.skillBuild.facets['blitz-beat'] = [0, 2, 1];
  }

  renderSkillBuilderUI();
}

function saveSkillBuild() {
  skillBuilderSnapshot = null;
  const modal = document.getElementById("skill-builder-modal");
  if (modal) modal.style.display = 'none';
  if (typeof markPlanDirty === 'function') markPlanDirty();
  updatePlanEditorBadges();
}

// 6. Stat Builder: an ordered queue of steps { stat, to } — the bot raises step 1 to its value, then step 2...
//    (like the skill queue). statBuild = { queue, targets (final values), priorityOrder } — targets/priority
//    are kept for older bots. Old plans without a queue: targets in priority order (what the bot did before).
const STAT_KEYS = ['STR', 'AGI', 'VIT', 'INT', 'DEX', 'LUK'];
const STAT_META = {
  STR: { icon: '💪', color: '#f87171', th: 'กายภาพ / แบกน้ำหนัก' },
  AGI: { icon: '⚡', color: '#34d399', th: 'ความเร็วโจมตี / หลบหลีก' },
  VIT: { icon: '🛡️', color: '#fbbf24', th: 'HP สูงสุด / ป้องกัน' },
  INT: { icon: '🔮', color: '#60a5fa', th: 'SP สูงสุด / เวท' },
  DEX: { icon: '🏹', color: '#38bdf8', th: 'แม่นยำ / โจมตีไกล / ร่ายไว' },
  LUK: { icon: '🍀', color: '#c084fc', th: 'คริติคอล / นกออกบ่อย' }
};
const STAT_PRESETS = {
  agi_dex: [['DEX', 30], ['AGI', 30], ['DEX', 60], ['AGI', 60], ['DEX', 99], ['AGI', 99], ['LUK', 9]],
  blitz_beat: [['DEX', 40], ['LUK', 30], ['AGI', 30], ['DEX', 80], ['LUK', 60], ['AGI', 80], ['INT', 20]],
  str_agi: [['STR', 30], ['AGI', 30], ['STR', 60], ['AGI', 60], ['VIT', 30], ['STR', 90], ['AGI', 90], ['DEX', 30]],
  int_dex: [['INT', 30], ['DEX', 30], ['INT', 60], ['DEX', 60], ['VIT', 30], ['INT', 99], ['DEX', 99]],
  vit_tank: [['VIT', 40], ['INT', 20], ['VIT', 70], ['DEX', 30], ['INT', 40], ['VIT', 99], ['STR', 30], ['INT', 60], ['DEX', 50]]
};
let statWork = null;   // the queue being edited (written to the plan only on save)

// Status points to raise a stat from v to v + 1 (game: floor((v - 1) / 10) + 2)
const statPointCost = v => Math.floor((v - 1) / 10) + 2;
const statRangeCost = (from, to) => { let c = 0; for (let v = from; v < to; v++) c += statPointCost(v); return c; };

// Valid queue: values 1..99, each step raises its stat, consecutive steps of the same stat merged
function normalizeStatQueue(q) {
  const lv = {};
  const out = [];
  (Array.isArray(q) ? q : []).forEach(e => {
    const k = String((e && e.stat) || '').toUpperCase();
    if (!STAT_KEYS.includes(k)) return;
    const to = Math.min(99, Math.max(1, parseInt(e.to, 10) || 1));
    if (to <= (lv[k] || 1)) return;
    if (out.length && out[out.length - 1].stat === k) out[out.length - 1].to = to;
    else out.push({ stat: k, to });
    lv[k] = to;
  });
  return out;
}
function statQueueOf(sb) {
  if (!sb) return [];
  if (Array.isArray(sb.queue) && sb.queue.length) return normalizeStatQueue(sb.queue);
  const t = sb.targets || {};
  const pr = Array.isArray(sb.priorityOrder) && sb.priorityOrder.length ? sb.priorityOrder : ['DEX', 'AGI', 'LUK', 'VIT', 'INT', 'STR'];
  return normalizeStatQueue(pr.map(k => ({ stat: k, to: t[String(k).toUpperCase()] })));
}
function statFinal(q) {
  const t = { STR: 1, AGI: 1, VIT: 1, INT: 1, DEX: 1, LUK: 1 };
  q.forEach(e => { t[e.stat] = Math.max(t[e.stat], e.to); });
  return t;
}
// Value of each step's stat before the step
function statStepFrom(q) {
  const lv = {};
  return q.map(e => { const from = lv[e.stat] || 1; lv[e.stat] = e.to; return from; });
}

function openStatBuilderModal() {
  if (!activeEditingPlan) return;
  statWork = statQueueOf(activeEditingPlan.statBuild);
  renderStatBuilderUI();
  const modal = document.getElementById("stat-builder-modal");
  if (modal) modal.style.display = 'flex';
}

function renderStatBuilderUI() {
  if (!statWork) return;
  const final = statFinal(statWork);
  const grid = document.getElementById('stat-cards-grid');
  if (grid) {
    grid.innerHTML = STAT_KEYS.map(k => {
      const m = STAT_META[k];
      const steps = [];
      statWork.forEach((e, i) => { if (e.stat === k) steps.push(i + 1); });
      const v = final[k];
      return `
        <div class="sb-card ${v > 1 ? 'on' : ''}" style="--sb-c: ${m.color};">
          <div class="sb-card-top">
            <span class="sb-name">${m.icon} ${k}</span>
            <span class="sb-val">${v}</span>
          </div>
          <div class="sb-desc">${m.th}</div>
          <div class="sb-btns">
            <button type="button" onclick="statQueueAdd('${k}', -1)" ${v <= 1 ? 'disabled' : ''} title="ลด 1 (จากขั้นล่าสุดของ ${k})">−</button>
            <button type="button" onclick="statQueueAdd('${k}', 1)" ${v >= 99 ? 'disabled' : ''}>+1</button>
            <button type="button" onclick="statQueueAdd('${k}', 5)" ${v >= 99 ? 'disabled' : ''}>+5</button>
            <button type="button" onclick="statQueueAdd('${k}', 10)" ${v >= 99 ? 'disabled' : ''}>+10</button>
            <button type="button" onclick="statQueueAdd('${k}', 99)" ${v >= 99 ? 'disabled' : ''} title="อัปจนถึง 99">99</button>
          </div>
          <div class="sb-steps">${steps.map(n => `<span>#${n}</span>`).join('')}</div>
        </div>`;
    }).join('');
  }
  const froms = statStepFrom(statWork);
  const box = document.getElementById('stat-queue-container');
  const count = document.getElementById('stat-queue-count');
  const costEl = document.getElementById('stat-queue-cost');
  if (count) count.textContent = statWork.length;
  const total = statWork.reduce((a, e, i) => a + statRangeCost(froms[i], e.to), 0);
  if (costEl) costEl.textContent = statWork.length ? `ใช้ Status Points รวม ${total.toLocaleString()} แต้ม` : '';
  if (box) {
    box.innerHTML = statWork.length ? statWork.map((e, i) => `
      <span class="sb-chip" style="--sb-c: ${STAT_META[e.stat].color};" title="ขั้นที่ ${i + 1}: ${e.stat} ${froms[i]} → ${e.to} (ใช้ ${statRangeCost(froms[i], e.to)} แต้ม)">
        <button type="button" class="sb-mv" onclick="statQueueMove(${i}, -1)" ${i === 0 ? 'disabled' : ''} aria-label="เลื่อนขึ้น">‹</button>
        <span class="sb-chip-no">#${i + 1}</span>
        <b>${e.stat}</b> ${froms[i]} → ${e.to}
        <button type="button" class="sb-mv" onclick="statQueueMove(${i}, 1)" ${i === statWork.length - 1 ? 'disabled' : ''} aria-label="เลื่อนลง">›</button>
        <button type="button" class="sb-del" onclick="statQueueRemove(${i})" aria-label="ลบ">&times;</button>
      </span>`).join('')
      : '<span class="sb-empty">ยังไม่มีลำดับ — กด +1 / +5 / +10 ที่สเตตัสด้านบนตามลำดับที่อยากให้อัป หรือเลือก Preset</span>';
  }
}

// +n (n = 99: up to 99) adds to the last step when it is the same stat, else a new step; -1 lowers the last
// step of that stat (removed when it no longer raises anything)
function statQueueAdd(stat, n) {
  if (!statWork) return;
  const final = statFinal(statWork);
  if (n < 0) {
    for (let i = statWork.length - 1; i >= 0; i--) {
      if (statWork[i].stat !== stat) continue;
      statWork[i].to -= 1;
      break;
    }
  } else {
    const to = n >= 99 ? 99 : Math.min(99, final[stat] + n);
    const last = statWork[statWork.length - 1];
    if (last && last.stat === stat) last.to = to;
    else statWork.push({ stat, to });
  }
  statWork = normalizeStatQueue(statWork);
  renderStatBuilderUI();
}
function statQueueRemove(i) {
  if (!statWork) return;
  statWork.splice(i, 1);
  statWork = normalizeStatQueue(statWork);
  renderStatBuilderUI();
}
function statQueueMove(i, dir) {
  if (!statWork) return;
  const j = i + dir;
  if (j < 0 || j >= statWork.length) return;
  [statWork[i], statWork[j]] = [statWork[j], statWork[i]];
  statWork = normalizeStatQueue(statWork);
  renderStatBuilderUI();
}
function resetStatQueue() {
  if (!statWork || !statWork.length) return;
  if (!confirm('ล้างลำดับการอัปสเตตัสทั้งหมด?')) return;
  statWork = [];
  renderStatBuilderUI();
}
window.statQueueAdd = statQueueAdd;
window.statQueueRemove = statQueueRemove;
window.statQueueMove = statQueueMove;

function applyStatPreset(presetKey) {
  const p = STAT_PRESETS[presetKey];
  if (!p || !statWork) return;
  if (statWork.length && !confirm('แทนที่ลำดับปัจจุบันด้วย Preset นี้?')) return;
  statWork = normalizeStatQueue(p.map(([stat, to]) => ({ stat, to })));
  renderStatBuilderUI();
}

function saveStatBuild() {
  if (!activeEditingPlan || !statWork) return;
  const queue = normalizeStatQueue(statWork);
  const targets = statFinal(queue);
  // older bots read targets + priority: first appearance order, the rest after
  const priorityOrder = [];
  queue.forEach(e => { if (!priorityOrder.includes(e.stat)) priorityOrder.push(e.stat); });
  ['DEX', 'AGI', 'LUK', 'VIT', 'INT', 'STR'].forEach(k => { if (!priorityOrder.includes(k)) priorityOrder.push(k); });
  activeEditingPlan.statBuild = { queue, targets, priorityOrder };
  statWork = null;
  if (typeof markPlanDirty === 'function') markPlanDirty();
  updatePlanEditorBadges();
  const modal = document.getElementById("stat-builder-modal");
  if (modal) modal.style.display = 'none';
}
function closeStatBuilder() {
  statWork = null;
  const modal = document.getElementById("stat-builder-modal");
  if (modal) modal.style.display = 'none';
}

// 7. Setup Event Listeners for Plan Builder Modals
function setupPlanBuilderEventListeners() {
  // Buttons in Plan Editor Header
  const btnOpenSkill = document.getElementById("btn-open-skill-builder");
  if (btnOpenSkill) btnOpenSkill.onclick = openSkillBuilderModal;

  const btnOpenStat = document.getElementById("btn-open-stat-builder");
  if (btnOpenStat) btnOpenStat.onclick = openStatBuilderModal;

  // Skill Builder Tab Buttons
  document.querySelectorAll('.skill-tab-btn').forEach(btn => {
    btn.onclick = () => {
      currentSkillBuilderTab = btn.getAttribute('data-tab');
      renderSkillBuilderUI();
    };
  });

  // Skill Builder Controls
  const btnSkillClose = document.getElementById("skill-builder-close-btn");
  const cancelSkillBuilder = () => {
    if (skillBuilderSnapshot && activeEditingPlan) activeEditingPlan.skillBuild = JSON.parse(skillBuilderSnapshot);
    skillBuilderSnapshot = null;
    document.getElementById("skill-builder-modal").style.display = 'none';
    updatePlanEditorBadges();
  };
  if (btnSkillClose) btnSkillClose.onclick = cancelSkillBuilder;
  const btnSkillCancel = document.getElementById("skill-builder-cancel-btn");
  if (btnSkillCancel) btnSkillCancel.onclick = cancelSkillBuilder;
  const btnSkillSave = document.getElementById("skill-builder-save-btn");
  if (btnSkillSave) btnSkillSave.onclick = saveSkillBuild;
  const btnSkillReset = document.getElementById("btn-skill-reset");
  if (btnSkillReset) btnSkillReset.onclick = resetSkillQueue;
  const btnSkillPreset = document.getElementById("btn-skill-apply-preset");
  if (btnSkillPreset) btnSkillPreset.onclick = applySkillPreset;

  // Stat Builder Controls
  const btnStatClose = document.getElementById("stat-builder-close-btn");
  if (btnStatClose) btnStatClose.onclick = closeStatBuilder;
  const btnStatCancel = document.getElementById("stat-builder-cancel-btn");
  if (btnStatCancel) btnStatCancel.onclick = closeStatBuilder;
  const btnStatReset = document.getElementById("btn-stat-reset");
  if (btnStatReset) btnStatReset.onclick = resetStatQueue;
  const btnStatSave = document.getElementById("stat-builder-save-btn");
  if (btnStatSave) btnStatSave.onclick = saveStatBuild;

  // Stat Presets
  const pAgiDex = document.getElementById("preset-stat-agi-dex");
  if (pAgiDex) pAgiDex.onclick = () => applyStatPreset('agi_dex');
  const pBlitz = document.getElementById("preset-stat-blitz");
  if (pBlitz) pBlitz.onclick = () => applyStatPreset('blitz_beat');
  const pStrAgi = document.getElementById("preset-stat-str-agi");
  if (pStrAgi) pStrAgi.onclick = () => applyStatPreset('str_agi');
  const pIntDex = document.getElementById("preset-stat-int-dex");
  if (pIntDex) pIntDex.onclick = () => applyStatPreset('int_dex');
  const pVit = document.getElementById("preset-stat-vit-tank");
  if (pVit) pVit.onclick = () => applyStatPreset('vit_tank');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupPlanBuilderEventListeners);
} else {
  setupPlanBuilderEventListeners();
}
