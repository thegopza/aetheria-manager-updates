// manager/public/update_log.js — Update Log Notification & History Modal for Manager UI
// กฎเหล็ก: เขียนเฉพาะว่า "ทำอะไรได้บ้าง" และ "แก้อะไรบ้าง" ด้วยภาษาผู้ใช้ที่เข้าใจง่าย ห้ามใส่รายละเอียดโค้ดหรือชื่อฟังก์ชันเด็ดขาด
(function () {
  'use strict';

  const STORAGE_KEY_SEEN_VER = 'pelican_seen_update_log_ver';

  const UPDATE_LOGS = [
    {
      version: 'v4.47.0',
      date: '28 ต.ค. 2026',
      title: 'อัปเกรดระบบเซ็ตอุปกรณ์แบบยืดหยุ่น (Flex Gear) ซื้อของมหากาพย์และเจมที่คุ้มกว่าอัตโนมัติ พร้อมปลดล็อกตีบวก +10',
      features: [
        'เพิ่มตัวเลือกจัดเซ็ตอุปกรณ์แบบยืดหยุ่นตามช่องสวมใส่และระดับความหายาก เช่น หมวกบน (หายาก), หมวกบน (หายาก [1]), เกราะ/เสื้อ (หายาก), ผ้าคลุม (หายาก), รองเท้า (หายาก), เครื่องดนตรี (หายาก) และธนู (หายาก) โดยคัดเฉพาะอุปกรณ์ที่อาชีพในแผนสวมใส่ได้จริง',
        'รองรับการเลือกซื้ออุปกรณ์ระดับมหากาพย์ให้อัตโนมัติเมื่อมีราคาถูกกว่าระดับหายากในช่องเดียวกัน (ในกรณีที่ไม่ได้บังคับเลือกแบบมีรูใส่การ์ดไว้)',
        'หากอุปกรณ์ชิ้นที่ระบุไว้ในแผนหมดตลาด บอทจะหาซื้ออุปกรณ์ชิ้นอื่นในช่องเดียวกันที่อาชีพในแผนใส่ได้และมีออปชั่นตรงตามที่ตั้งไว้มาใส่แทนทันที เพื่อให้แผนเดินหน้าต่อได้ไม่สะดุด',
        'ปรับปรุงการซื้อเจมในตลาดกลาง หากเจมชนิดเดียวกันที่มีเปอร์เซ็นต์สูงกว่าที่ตั้งไว้มีราคาถูกกว่าหรือเท่ากัน บอทจะเลือกซื้อเจมเปอร์เซ็นต์สูงที่คุ้มกว่าให้ทันที'
      ],
      fixes: [
        'แก้ไขปัญหาที่บอทหยุดรอและไม่ยอมตีบวกอุปกรณ์จาก +9 ขึ้น +10 แม้มีเงินครบตามที่ตั้งไว้แล้ว โดยให้ใช้ใบกันแตกอัตโนมัติหากมีในกระเป๋า และหากไม่มีจะดำเนินการตีบวก +10 ต่อให้ทันทีโดยไม่ค้าง'
      ]
    },
    {
      version: 'v4.46.2',
      date: '28 ต.ค. 2026',
      title: 'อัปเดตระบบจำลองเครื่อง (Device Spoof) เป็น 1 เครื่องต่อ 3 จอ พร้อมเมนูจัดการกลุ่ม Device ด้านขวา',
      features: [
        'ปรับระบบจำลองเลขเครื่องเป็นรูปแบบ 1 เครื่องต่อ 3 จอ (1 Device : 3 จอ) โดยจัดกลุ่มโปรไฟล์ให้อัตโนมัติ กลุ่มละไม่เกิน 3 จอ ใช้รหัสเครื่องชุดเดียวกันตามจำนวนที่ตัวเกมอนุญาตให้เล่นพร้อมกันได้',
        'เพิ่มปุ่มเมนู "Device" (รูปฟันเฟือง ⚙️) ที่แถบด้านขวาใต้ปุ่มคุก แสดงรายการกลุ่มเครื่องทั้งหมดว่าแต่ละกลุ่มมีจอไหนและไอดีไหนใช้งานอยู่บ้าง พร้อมสถานะออนไลน์ของแต่ละจอ',
        'สามารถกดปุ่มสุ่มเลขเครื่องใหม่ (Random Device) แยกเฉพาะกลุ่มที่ต้องการ หรือกดสุ่มเลขเครื่องใหม่ทั้งหมดทุกกลุ่มพร้อมกันได้ทันทีในคลิกเดียว'
      ],
      fixes: [
        'ป้องกันไม่ให้เลขเครื่องของจอในกลุ่มเดียวกันแยกออกจากกันเอง เพื่อให้ทั้ง 3 จอในกลุ่มใช้เลขเครื่องเดียวกันอย่างถูกต้องเสมอ'
      ]
    },
    {
      version: 'v4.46.1',
      date: '27 ต.ค. 2026',
      title: 'ปรับปรุงการผูกบัญชีส่วนบุญและกู้คืนรายชื่อจอของแต่ละเครื่องอัตโนมัติ รวมถึงแก้ไขการตัดยอดส่วนบุญรายวัน',
      features: [
        'เมื่อแตกไฟล์โปรแกรมใหม่ลงในเครื่องเดิม ระบบจะจดจำรหัสเครื่องและดึงยอดส่วนบุญคงเหลือพร้อมรายชื่อจอเกมและรหัสผ่านทั้งหมดของเครื่องนั้นกลับมาให้โดยอัตโนมัติ ไม่ต้องตั้งค่าจอใหม่ตั้งแต่ต้น',
        'เพิ่มระบบป้องกันข้อมูลจอข้ามเครื่อง หากเผลอนำโฟลเดอร์จากเครื่องอื่นมาเปิด ระบบจะสลับกลับเป็นบัญชีและรายชื่อจอของเครื่องตัวเองให้อัตโนมัติทันที โดยไม่นำรายชื่อจอของคนอื่นมาปะปนหรือทับข้อมูลเดิม'
      ],
      fixes: [
        'แก้ไขปัญหาที่บอทไม่ยอมขายผ้าคลุม Angelic Cardigan และ Angelic Cardigan [1] ให้ร้านค้า แม้ตั้งเกณฑ์ระดับความหายากที่ต้องการขายไว้ครอบคลุมแล้ว',
        'แก้ไขปัญหาที่บางเครื่องย้ายโฟลเดอร์โปรแกรมหรือเปิดใช้งานต่อเนื่องแล้วยอดส่วนบุญค้าง ไม่ตัดยอดตามจำนวนจอที่เปิดใช้งานจริง',
        'แก้ไขปัญหาที่หลังรีสตาร์ทเครื่องหรือลงไฟล์ใหม่แล้วรายชื่อจอเดิมหายไปหรือแสดงรายชื่อจอของเครื่องอื่นแทน'
      ]
    },
    {
      version: 'v4.46.0',
      date: '26 ต.ค. 2026',
      title: 'อัปเดตแมพฟาร์มใหม่ โลกที่ 2 (ดินแดนรูน Lv. 150-190) และรองรับการเดินทางข้ามโลกอัตโนมัติ',
      features: [
        'เพิ่มรายชื่อแมพฟาร์มใหม่ของโลกที่ 2 (ดินแดนรูน) ครบทั้ง 4 แมพ ได้แก่ ดินแดนน้ำแข็ง (Lv. 150-160), ที่ราบศิลา (Lv. 155-165), สุสานรูนโบราณ (Lv. 165-175) และคุกใต้ดินรูน (Lv. 170-190) ทั้งในเมนูเลือกแมพฟาร์มเป้าหมายและในหน้าวางแผนการเล่น (Plan)',
        'รองรับการสลับหน้าแผนที่โลกไปยังแท็บ "ดินแดนรูน" อัตโนมัติเมื่อสั่งวาร์ปหรือเดินไปแมพในโลกที่ 2',
        'หากเลือกไปฟาร์มแมพด้านในของดินแดนรูนที่ตัวละครยังไม่เคยเปิดจุดวาร์ปมาก่อน บอทจะวาร์ปไปลงแมพทางผ่านในดินแดนรูนที่เปิดแล้วก่อน แล้วเดินเท้าต่อไปจนถึงแมพเป้าหมายเพื่อปลดล็อกจุดวาร์ปให้อัตโนมัติ'
      ],
      fixes: [
        'ปรับปรุงการย้ายแมพฟาร์มข้ามโลก (ระหว่างโลก Aetheria และดินแดนรูน) ให้แวะกลับเมืองหลวงเพื่อใช้วาร์ปจาก NPC Alice อัตโนมัติ แม้ตั้งค่าประหยัดค่าวาร์ปไว้ก็จะวาร์ปให้เมื่อไม่สามารถเดินเท้าข้ามโลกได้'
      ]
    },
    {
      version: 'v4.45.0',
      date: '26 ต.ค. 2026',
      title: 'เพิ่มระบบวางแผนปลุกพลังสกิล (Awakening / Awake Skill) และอัปเดตสกิลใหม่ทั้งหมดในระบบแผนการเล่น (Plan)',
      features: [
        'เพิ่มการตั้งค่า "ปลุกพลังสกิล (Awakening)" ในหน้าวางแผนอัปสกิลของระบบ Plan สามารถเลือกสายปลุกพลังสกิลล่วงหน้าได้ครบทั้ง 3 ขั้น (เช่น ขั้น Lv.5, Lv.12, Lv.15 หรือ Lv.3, Lv.6, Lv.10) พร้อมแสดงคำอธิบายผลของแต่ละสายให้เห็นชัดเจนทันทีบนการ์ดสกิล',
        'เมื่อตัวละครมีเลเวลสกิลรวม (จากแต้มสกิลและโบนัสอุปกรณ์/ศิลาปลุกพลัง) ถึงระดับที่ปลดล็อกแต่ละขั้น บอทจะกดเลือกสายปลุกพลังสกิลตามที่ตั้งไว้ในแผนให้อัตโนมัติทันที และหากมีการเปลี่ยนสายที่เคยเลือกไว้แล้ว บอทจะสลับสายใหม่ให้อัตโนมัติเมื่อตัวละครกลับเข้าเมือง',
        'อัปเดตรายการสกิลใหม่ทั้งหมดที่เพิ่งเพิ่มเข้ามาในเกมให้ครบทุกอาชีพในหน้าวางแผนสกิล (ได้แก่ สกิลใหม่ของ Wizard, Sage, Crusader, Priest, Monk และ Alchemist) พร้อมรองรับการเปิดใช้ในระบบต่อสู้อัตโนมัติ'
      ],
      fixes: [
        'อัปเดตข้อมูลเงื่อนไขสกิลและคำอธิบายสกิลทุกอาชีพในหน้าวางแผนให้ตรงกับข้อมูลล่าสุดของตัวเกม'
      ]
    },
    {
      version: 'v4.44.20',
      date: '26 ต.ค. 2026',
      title: 'เพิ่มระบบตั้งค่าซื้อของบริจาคกิลด์และแลกหินร้านค้ากิลด์อัตโนมัติ (Enchant Rune & Accessory Enchant Rune) และแก้ไขปุ่มเฉลี่ยเงินอัปเลเวลกิลด์',
      features: [
        'เพิ่มปุ่ม "ตั้งค่าบริจาค & แลกหิน" ในหน้าจัดการกิลด์ ให้ผู้ใช้งานเลือกได้เองว่าจะให้บอทแลกหินร้านค้ากิลด์ชนิดใดและจำนวนเท่าไรต่อวัน (รองรับทั้ง Accessory Enchant Rune และ Enchant Rune) พร้อมตารางคำนวณคะแนนกิลด์ต่อวันและจำนวนเงินที่ต้องบริจาคเพิ่มให้เห็นชัดเจนทันที',
        'เพิ่มระบบซื้อไอเทมบริจาคกิลด์รายวันที่ขาดจากตลาดกลางให้อัตโนมัติ (จำกัดวันละ 1 ครั้งต่อตัวละครตามกฎเกม) สำหรับตัวละครที่ฟาร์มอยู่ในแมพสูงที่หินบริจาคไม่ดรอป โดยซื้อเฉพาะจำนวนที่ยังขาดในราคาไม่เกินที่กำหนด กดรับของเข้ากระเป๋า แล้วส่งบริจาคเข้ากิลด์ให้ทันที',
        'เพิ่มระบบบริจาคเงินสมทบและแลกหินร้านค้ากิลด์อัตโนมัติ: หลังจากตัวละครบริจาคไอเทมรายวันเสร็จแล้ว ระบบจะคำนวณคะแนนกิลด์ที่มีอยู่เทียบกับหินที่เลือกไว้ หากคะแนนยังไม่พอแลกจะบริจาคเงินเพิ่มให้พอดีกับคะแนนที่ขาด แล้วกดแลกหินร้านค้ากิลด์ให้ครบตามโควต้ารายวัน พร้อมแสดงป้ายสถานะการแลกหินของแต่ละตัวละคร',
        'เพิ่มแถบปุ่มฟักทอง "แลกของ Halloween (NPC Witch Hazel)" ไว้ที่ขอบซ้ายของหน้าหลัก Manager แสดงรายการของรางวัลกิจกรรมครบทุกชิ้น สามารถตั้งจำนวนขั้นต่ำที่ต้องการแลกและซิงค์ตั้งค่าไปใช้กับทุกจอในคลิกเดียว',
        'เพิ่มแถบใหม่ "4 ตลาดกลาง" และแถบย่อย "Auto Sell ตลาดกลาง" ในหน้าต่างคลิกดูตัวละคร พร้อมระบบ "Copy To จออื่น" สำหรับคัดลอกรายการตั้งขายอัตโนมัติไปให้จออื่นหรือทุกจอได้ทันที',
        'เพิ่มช่องระบุจำนวนเงินบริจาคและปุ่มลัดเลือกจำนวนเงินภายในแต่ละการ์ดกิลด์ รวมถึงหน้าต่างระบุจำนวนเงินเมื่อกดปุ่ม "บริจาคเงิน" ของแต่ละตัวละคร'
      ],
      fixes: [
        'นำเสียงแจ้งเตือนตอนแก้ Captcha ออกจากหน้า Manager เพื่อไม่ให้มีเสียงรบกวนระหว่างเปิดบอทหลายจอ',
        'แก้ไขปุ่ม "พอดีอัป Lv." ในการ์ดกิลด์ให้คำนวณหารเฉลี่ยจำนวนเงินตามจำนวนจอที่ออนไลน์ในกิลด์นั้น (แทนที่จะใส่ยอดเต็มของทั้งกิลด์ลงในทุกตัวละคร) และจำกัดยอดบริจาครวมทั้งกิลด์ไม่ให้เกินจำนวนค่าประสบการณ์ที่กิลด์ต้องการใช้เลเวลอัปจริง',
        'แก้ไขกรอบตั้งราคาและปุ่มลงขายด้านล่างในหน้าลงขายไอเทมไม่ให้ซ้อนทับกับตารางรายการคนขายและประวัติราคา',
        'แก้ไขปุ่มยกเลิกขายและปุ่มกดรับของในหน้าตลาดกลางให้ส่งรายการได้ถูกต้องทันที และแก้ไขให้ทุกจอที่เปิดบอทเดินกลับเมืองหลวงไปแลกของ Halloween อัตโนมัติทันทีที่เก็บวัตถุดิบครบตามเงื่อนไข',
        'แก้ไขปัญหาย้ายโฟลเดอร์โปรแกรมข้ามเครื่องคอมพิวเตอร์แล้วหน้าจอเกมค้างสถานะกำลังเชื่อมต่อและสคริปต์บอทไม่เริ่มทำงาน ให้ระบบล้างแคชของเครื่องเก่าและดาวน์โหลดชุดสคริปต์สำหรับเครื่องใหม่ให้อัตโนมัติ'
      ]
    },
    {
      version: 'v4.44.19',
      date: '24 ต.ค. 2026',
      title: 'เพิ่มปุ่มตั้งขาย Token รายตัวละครและปุ่มขายทุกตัวด้วยราคาตั้งขายที่ถูกสุดในตลาด',
      features: [
        'เพิ่มปุ่ม "ขาย" ใต้ปุ่ม "ซื้อ" ของแต่ละตัวละครในหน้าจัดการ Premium สามารถเลือกจำนวนเหรียญและสั่งตั้งขายตามราคาตั้งขายที่ถูกสุดในตลาดกลางได้ทันทีโดยไม่ขายตัดเข้าฝั่งคนรับซื้อ',
        'เพิ่มปุ่ม "ขายทุกตัว" ด้านบนสุดของหน้าจัดการ Premium เพื่อสั่งตั้งขาย Token ที่มีอยู่ในทุกตัวละครที่ออนไลน์พร้อมกันในคลิกเดียวด้วยราคาตั้งขายที่ถูกสุด',
        'รองรับตัวเลือกตัดราคาลง 1 z การกำหนดราคาขายเอง และการกดรับเงินจากการขายเข้ากระเป๋าตัวละครให้อัตโนมัติทันทีที่มีผู้เล่นมาซื้อสำเร็จ'
      ],
      fixes: [
        'ป้องกันระบบซื้ออัตโนมัติทำงานซ้อนทับหรือนำเงินที่ได้จากการขายกลับไปซื้อ Token ซ้ำในตัวละครที่กำลังตั้งขายอยู่'
      ]
    },
    {
      version: 'v4.44.18',
      date: '24 ต.ค. 2026',
      title: 'รองรับระบบแสดงค่าปิงใหม่หลังอัปเดตเกม แก้ไขชื่อแมพปัจจุบันและเลเวลตัวละครไม่แสดงผลบนหน้า Manager',
      features: [
        'รองรับรูปแบบแผนที่ย่อและแถบสถานะตัวละครแบบใหม่หลังตัวเกมอัปเดตเพิ่มตัวเลขความหน่วงสัญญาณ (Ping ms) และการซ่อนข้อมูลอัตโนมัติบนหน้าต่างเกมขนาดเล็ก',
        'อ่านชื่อแมพปัจจุบัน เลเวลตัวละคร และหลอดค่าประสบการณ์ได้ครบถ้วนทุกหน้าจอแม้ย่อขนาดหน้าต่างเกมหรือพับแถบสถานะตัวละครไว้'
      ],
      fixes: [
        'แก้ไขปัญหาช่อง "แมพปัจจุบัน" บนการ์ดหน้าจอในระบบ Manager แสดงตัวเลขค่าความหน่วงสัญญาณ (เช่น 15 ms) แทนชื่อแมพจริงหลังตัวเกมอัปเดต',
        'แก้ไขปัญหาตัวเลข Base Lv., Job Lv. และเปอร์เซ็นต์ค่าประสบการณ์แสดงเป็นขีดว่าง (--) เมื่อเปิดแสดงหน้าต่างเกมขนาดเล็กโดยไม่ได้กดซ่อนจอ',
        'ป้องกันระบบนำข้อความค่าปิงหรือชื่อจุดวาร์ปบนแผนที่ย่อมาเข้าใจผิดว่าเป็นชื่อแมพปัจจุบันระหว่างกำลังโหลดเปลี่ยนแผนที่'
      ]
    },
    {
      version: 'v4.44.17',
      date: '23 ต.ค. 2026',
      title: 'แก้ไขระบบเซ็ตอุปกรณ์ (Set Gear) และเจมในแผนอัตโนมัติ ให้ซื้อสวมใส่และตีบวกได้ครบทุกชิ้นไม่ค้างคิว',
      features: [
        'ปรับระบบเซ็ตอุปกรณ์ในแผนอัตโนมัติให้ไล่ซื้อและสวมใส่อุปกรณ์และเจมที่เงินถึงและเลเวลถึงได้ทันทีโดยไม่ต้องรอให้ขั้นตอนตีบวกชิ้นก่อนหน้าทำสำเร็จครบก่อน',
        'เมื่อเจมระดับเปอร์เซ็นต์ที่ตั้งไว้ในแผนไม่มีคนลงขายในตลาดกลาง บอทจะค้นหาและซื้อเจมชนิดเดียวกันที่มีเปอร์เซ็นต์สูงกว่าและอยู่ในงบที่ตั้งไว้มาใส่แทนให้อัตโนมัติ',
        'รองรับการตีบวกเจมที่สวมใส่อยู่แม้เป็นระดับเปอร์เซ็นต์ที่สูงกว่าในแผน และป้องกันการสลับเอาเจมใหม่ที่ยังไม่ตีบวกมาทับเจมเดิมที่ตีบวกจนมีค่าเปอร์เซ็นต์รวมสูงกว่า',
        'รองรับการซื้อแร่ตีบวกจากตลาดกลางที่ผู้เล่นวางขายเป็นกองใหญ่ และค้นหาแร่ได้ลึกขึ้นทุกหน้าตลาดโดยไม่ถูกแร่ชนิดอื่นบัง'
      ],
      fixes: [
        'แก้ไขปัญหาตัวละครมีเงินครบตามเงื่อนไขแล้วแต่ค้างอยู่ที่ขั้นตอนตีบวกอาวุธ (เช่น รอใบกันแตกหรือรอแร่) จนไม่ยอมซื้ออุปกรณ์ชิ้นอื่น เจม หรือการ์ดในเซ็ตมาสวมใส่',
        'แก้ไขปัญหาบอทหาซื้อแร่ตีบวกในตลาดไม่ได้เมื่อไม่มีคนแยกขายกองเล็ก และแก้ปัญหาสวมใส่เจมประจำอาชีพไม่ได้เมื่อช่องเจมทั้ง 4 ช่องมีเจมชนิดอื่นที่ไม่ได้อยู่ในแผนใส่อยู่เต็ม'
      ]
    },
    {
      version: 'v4.44.16',
      date: '22 ต.ค. 2026',
      title: 'เพิ่มปุ่มเปิด/ปิดระบบพระในปาร์ตี้ & แก้หยุดตีมอนกลางคัน + รองรับบริจาคกิลด์นอกและบังคับบริจาคเงินเข้ากิลด์',
      features: [
        'เพิ่มสวิตช์ "ระบบ Priest (บัฟตี้)" ในหน้าปาร์ตี้ สามารถเลือกปิดระบบเดินตามและบัฟของพระได้ เพื่อให้ทำงานเฉพาะการเชิญเข้าตี้และแชร์ค่าประสบการณ์ตามปกติ',
        'แสดงรายชื่อตัวละครที่เข้ากิลด์อื่นนอกเหนือจากกิลด์ที่สร้างผ่าน Manager พร้อมช่องติ๊กเลือกเปิด/ปิดการบริจาคไอเทมรายวันแยกตามตัวละครแต่ละจอได้อิสระ',
        'เพิ่มระบบบังคับบริจาคเงิน (Zeny) และไอเทมเข้ากิลด์ สามารถตั้งจำนวนเงินและยอดเงินขั้นต่ำที่ต้องการเหลือติดตัว แล้วกดสั่งบริจาครายตัว รายกิลด์ หรือสั่งบริจาคเรียงทุกหน้าจอพร้อมกันได้ทันที'
      ],
      fixes: [
        'แก้ไขปัญหาตัวละครในปาร์ตี้ที่กำลังโจมตีมอนสเตอร์ใกล้ตาย หรือกำลังเดินไปหามอนสเตอร์ แล้วถูกยกเลิกการโจมตีกลางคันเพื่อเดินกลับไปหาพระ',
        'แก้ไขปัญหาตัวละครที่สังกัดกิลด์ของคนอื่น (ไม่ได้สร้างกิลด์ในระบบ Manager) ไม่สามารถใช้ระบบบริจาคไอเทมรายวันอัตโนมัติได้'
      ]
    },
    {
      version: 'v4.44.15',
      date: '22 ต.ค. 2026',
      title: 'ป้องกันการย้ายเข้าแนล PK อัตโนมัติ & ปรับระบบพระในปาร์ตี้ให้เปิด AUTO ตลอดเพื่อให้ตีมอนฟื้นฟูมานาและบัฟต่อเนื่อง',
      features: [
        'เพิ่มระบบกรองแนล PK ออกจากระบบค้นหาแนลที่คนน้อยที่สุดทุกระบบ (ทั้งตอนเข้าแมพฟาร์ม, หลังขายของกลับแมพ, ระบบรวมปาร์ตี้ และระบบรวมเงิน)',
        'หากตัวละครหลุดเข้าไปอยู่ในแนล PK บนแมพฟาร์ม บอทจะหยุดโจมตีชั่วคราวและย้ายออกไปยังแนลปกติที่คนน้อยที่สุดให้อัตโนมัติทันที',
        'ปรับระบบพระ (Priest) ในปาร์ตี้ให้เปิด AUTO ค้างไว้ตลอดเวลาขณะเดินและบัฟ เพื่อให้พระตีมอนสเตอร์ฟื้นฟูมานา (SP) ได้ต่อเนื่องและใช้ระบบบัฟอัตโนมัติของเกมร่วมกันได้อย่างลื่นไหล'
      ],
      fixes: [
        'แก้ไขปัญหาตัวเกมอัปเดตเพิ่มแนล PK ที่มีคนน้อยกว่าแนลปกติ แล้วบอทเข้าใจว่าเป็นแนลว่างจนสั่งย้ายตัวละครหรือดึงสมาชิกปาร์ตี้เข้าไปในแนล PK',
        'แก้ไขปัญหาบอทสั่งปิด AUTO ของพระตอนเดินไปบัฟจนพระยืนนิ่งไม่ตีมอนสเตอร์ ทำให้มานาไม่เด้งและไม่สามารถร่ายบัฟให้เพื่อนในตี้ต่อได้'
      ]
    },
    {
      version: 'v4.44.14',
      date: '22 ต.ค. 2026',
      title: 'แก้ไขการตั้งค่าหายหลังกด F5, แผนติดไปจออื่นที่ไม่ได้ติ๊ก & แก้เครื่องช้ารีเฟรชหน้าเกมวนลูป',
      features: [
        'แยกการจัดเก็บข้อมูลการตั้งค่าและแผนของแต่ละหน้าจอออกจากกันอย่างเด็ดขาด แม้เปิดหลายหน้าต่างในเบราว์เซอร์เดียวกัน',
        'คงค่าการตั้งค่าบอทในเกม (เช่น ยาปั๊มเลือด/มานา, การเก็บของ, การรับปาร์ตี้) ไว้ครบถ้วนเมื่อเปิดใช้งานระบบแผนอัตโนมัติ',
        'ปรับปรุงการอ่านสถานะหน้าจอสำหรับเครื่องที่เปิดหลายจอหรือกำลังโหลดแมพ ให้การ์ดสถานะแสดงผลต่อเนื่องไม่กระพริบเป็นออฟไลน์'
      ],
      fixes: [
        'แก้ไขปัญหานำเข้าการตั้งค่า (Import Config) หรือปรับตั้งค่าแล้วกดรีเฟรช (F5) แล้วการตั้งค่ากลับไปเป็นค่าเก่าหรือหายไป',
        'แก้ไขปัญหาจอที่ไม่ได้ติ๊กเลือกใช้แผนในหน้า Manager แต่กลับมีแผนจากจออื่นติดเข้าไปเปิดทำงานเอง',
        'แก้ไขปัญหาเครื่องที่โหลดแมพช้าหรือเปิดหลายจอแล้วถูกสั่งรีเฟรชหน้าเกมซ้ำๆ วนลูปขณะกำลังโหลดเข้าแมพ'
      ]
    },
    {
      version: 'v4.44.13',
      date: '22 ต.ค. 2026',
      title: 'แก้ไขการเช็คชื่อไอเทมใน Whitelist ให้ตรงชื่อเป๊ะ ไม่เหมารวมไอเทมที่มีคำคล้ายกัน',
      features: [
        'ปรับการเทียบชื่อไอเทมใน Whitelist ให้แยกชื่อไอเทมแต่ละชนิดออกจากกันอย่างชัดเจน เช่น ใส่เฉพาะ Elunium จะไม่เหมารวม Rough Elunium หรือ Enriched Elunium อีกต่อไป'
      ],
      fixes: [
        'แก้ไขปัญหาใส่แค่ Elunium ใน Whitelist แล้วบอทเข้าใจว่า Rough Elunium อยู่ใน Whitelist ด้วยจนไม่ยอมขาย Rough Elunium ให้ NPC'
      ]
    },
    {
      version: 'v4.44.12',
      date: '22 ต.ค. 2026',
      title: 'ซิงค์ไอดีและรหัสผ่านจากเมนูบอทในเกมเข้าหน้า Manager อัตโนมัติ & ป้องกันบอทสุ่มไอดีใหม่ทับไอดีที่ผู้ใช้งานสมัครเอง',
      features: [
        'ดึงข้อมูลชื่อผู้ใช้ (ID) และรหัสผ่าน (PS) ที่กรอกไว้ในเมนูบอทภายในเกม หรือกรอกเข้าสู่ระบบด้วยตัวเอง มาแสดงและบันทึกในหน้า Manager ให้อัตโนมัติทันทีโดยไม่ต้องกรอกซ้ำ 2 ที่',
        'เมื่อแก้ไขชื่อผู้ใช้หรือรหัสผ่านผ่านเมนูบอทจากหน้า Manager ระบบจะบันทึกเข้าโปรไฟล์ของจอนั้นให้ตรงกันทันที'
      ],
      fixes: [
        'แก้ไขปัญหาผู้ใช้งานใส่ ID และรหัสผ่านที่สมัครเองไว้ในเมนูบอทภายในเกม แต่หน้า Manager มองเห็นเป็นช่องว่างแล้วสุ่มสร้างไอดีใหม่เข้าไปทับไอดีเดิมของผู้ใช้งาน',
        'เพิ่มระบบป้องกันไม่ให้ระบบสมัครอัตโนมัติทำงานทับจอที่มีไอดีของผู้ใช้งานกรอกไว้อยู่แล้วในทุกกรณี'
      ]
    },
    {
      version: 'v4.44.11',
      date: '22 ต.ค. 2026',
      title: 'แก้ไขระบบคุย NPC เพื่อฮีลฟื้นฟูเลือดและมานาให้เต็มก่อนวาร์ปกลับไปฟาร์ม',
      features: [
        'เมื่อตัวละครอยู่ในเมืองหลวงและเตรียมกลับแมพฟาร์ม (ทั้งหลังตายเกิดใหม่และหลังขายของเสร็จ) จะแวะคุยกับ NPC ในเมืองเพื่อกดฮีลฟื้นฟูเลือดและมานาให้เต็ม 100% ก่อนค่อยเปิดแผนที่วาร์ปกลับไปฟาร์มเสมอ',
        'รองรับการแวะฮีลฟรีกับ NPC ในเมืองก่อนออกเดินทาง แม้ในกรณีที่ตั้งประหยัดค่าวาร์ปแล้วเดินเท้ากลับแมพฟาร์ม'
      ],
      fixes: [
        'แก้ไขปัญหาบอทอ่านค่าเลือดและมานาสูงสุดไม่ครบ ทำให้เข้าใจว่าเลือดและมานาเต็มอยู่แล้ว จึงข้ามการกดฮีลแล้ววาร์ปกลับไปฟาร์มทันทีทั้งที่เลือดยังไม่เต็ม',
        'แก้ไขจังหวะการเดินจากร้านค้าไปหา NPC วาร์ป และการเปิดบทสนทนาซ้ำหลังกดฮีลเสร็จ ให้ต่อเนื่องไม่หลุดหรือข้ามขั้นตอน'
      ]
    },
    {
      version: 'v4.44.10',
      date: '22 ต.ค. 2026',
      title: 'แก้ไขพระเดินไปบัพเพื่อนที่เพิ่งกลับมาจากเมือง/ตายวาร์ปกลับมา & ป้องกันตัวไม่มีบัพวิ่งฝ่าฝูงมอนไปตาย',
      features: [
        'พระตรวจจับสมาชิกในตี้ที่เพิ่งวาร์ปกลับมาจากเมืองหรือตายแล้วกลับมาแบบไม่มีบัพติดตัวได้ทันที และจัดคิวเดินไปหาเพื่อร่ายบัพครบทุกสกิลให้เป็นอันดับแรก',
        'ตัวละครที่เพิ่งกลับเข้าแมพฟาร์มและยังไม่มีบัพพระ จะไม่วิ่งฝ่าฝูงมอนสเตอร์ข้ามแมพไปหาพระจนตายกลางทาง แต่จะป้องกันตัวรอให้พระเดินเข้ามาบัพให้ถึงที่อย่างปลอดภัย'
      ],
      fixes: [
        'แก้ไขปัญหาพระยืนตีมอนอยู่กับที่และไม่ยอมเดินไปหาเพื่อนในตี้ที่ไม่มีบัพหรือบัพใกล้หมด',
        'แก้ไขระบบซิงค์สถานะปาร์ตี้ให้ส่งคิวบัพและตำแหน่งพระให้ทุกจอในปาร์ตี้ได้ต่อเนื่องไม่สะดุด'
      ]
    },
    {
      version: 'v4.44.9',
      date: '21 ต.ค. 2026',
      title: 'แสดงอัตราเก็บค่าส่วนบุญต่อจอวันนี้ & ปรับยอดส่วนบุญให้ตรงกันทุกเครื่อง',
      features: [
        'แสดงข้อความ "เก็บค่าส่วนบุญวันนี้ = X บุญ ต่อจอ" บนแถบด้านบนของหน้า Manager หน้าใบสรุปส่วนบุญ และหน้าผู้ดูแลระบบ เพื่อให้เห็นเรทที่เก็บจริงในวันนี้ได้ชัดเจนทันที'
      ],
      fixes: [
        'แก้ไขปัญหาปรับเรทส่วนบุญต่อจอในหน้าผู้ดูแลระบบแล้ว บางเครื่องยังแสดงหรือคิดเรทวันก่อนหน้า (เช่น ตั้งไว้ 1 บุญต่อจอ แต่เครื่องเพื่อนยังขึ้น 2.5 บุญต่อจอ)',
        'เมื่อมีการปรับลดเรทส่วนบุญประจำวัน ระบบจะคืนส่วนต่างส่วนบุญของจอที่เปิดไปแล้วในวันเดียวกันให้ตรงตามเรทใหม่อัตโนมัติ',
        'แก้ไขแถบเลือกโหมดเช็ค Channel ซ้อนขึ้นมาอีกจุดที่มุมซ้ายบนของหน้าจอ ให้แสดงเฉพาะจุดหลักบนแถบเครื่องมือจุดเดียว',
        'ปรับให้ระบบแยก IP รายจอ (1 IP ต่อ 3 จอ) ปิดการใช้งานอัตโนมัติเป็นค่าเริ่มต้น และให้จอที่เปิดอยู่สลับมาใช้เน็ตบ้านปกติโดยไม่ต้องปิดจอเกม'
      ]
    },
    {
      version: 'v4.44.8',
      date: '21 ต.ค. 2026',
      title: 'โหมดย้าย CH คนน้อยสุดทุกครั้งที่เข้าแมพฟาร์ม & แยก CH ไม่ให้แต่ละตี้ทับกัน',
      features: [
        'เพิ่มโหมดใหม่ "ทุกครั้งที่เข้าแมพฟาร์ม" สำหรับจอเดี่ยว: สแกนหาและย้ายไป Channel ที่คนน้อยที่สุดทุกครั้งเมื่อกลับเข้าแมพฟาร์ม ไม่ว่าจะกลับมาจากเมือง ตายแล้วเดินกลับมา หรือเพิ่งเริ่มฟาร์ม',
        'รองรับระบบปาร์ตี้ในโหมดใหม่: เมื่อสมาชิกคนใดคนหนึ่งเพิ่งกลับมาจากเมืองหรือตายแล้วกลับมาถึงแมพฟาร์มและย้ายไป Channel ที่คนน้อยที่สุด สมาชิกทั้งตี้จะย้ายตามไปรวมกันที่ Channel นั้นทันที',
        'ระบบแยก Channel ระหว่างปาร์ตี้อัตโนมัติ: ป้องกันไม่ให้แต่ละปาร์ตี้ของเราไปอยู่ทับ Channel เดียวกัน หาก Channel ที่คนน้อยสุดมีอีกปาร์ตี้ของเราฟาร์มอยู่แล้ว ระบบจะเลือก Channel ที่คนน้อยรองลงมาให้แทนทันที'
      ],
      fixes: [
        'ป้องกันปาร์ตี้หลายกลุ่มที่ฟาร์มแมพเดียวกันย้ายไปกระจุกซ้ำใน Channel เดียวกัน'
      ]
    },
    {
      version: 'v4.44.7',
      date: '21 ต.ค. 2026',
      title: 'ปลดล็อคขายตลาดกลางไม่ต้องมี Premium & ขายของใช้ให้ NPC',
      features: [
        'ปลดล็อคขายของลงตลาดกลางอัตโนมัติ แม้ไม่มี Premium ก็ตั้งขายได้แล้ว (ไม่มี Premium ลงขายได้สูงสุด 3 ชิ้น / มี Premium ลงขายได้ 20 ชิ้น)',
        'เพิ่มตัวเลือกขายของใช้และขวดยาให้ NPC อัตโนมัติ (ในแท็บขายของ) โดยจะเก็บใบวาป ยาบัพที่เปิดใช้งาน และของใน Whitelist ไว้ให้ปลอดภัย',
        'เพิ่มระบบแจ้งเตือน Update Log หน้า Manager เพื่อดูว่าแต่ละอัปเดตทำอะไรได้บ้างและแก้อะไรบ้าง'
      ],
      fixes: [
        'ปรับการแสดงจำนวนโควตาตั้งขายตลาดกลางให้ตรงตามสิทธิ์ของตัวละครจริง'
      ]
    },
    {
      version: 'v4.44.6',
      date: '21 ต.ค. 2026',
      title: 'บันทึกตั้งค่ารายโปรไฟล์ & แก้บัคกลับเมืองไปหาช่างตีเหล็กเอง',
      features: [
        'จำการตั้งค่าบอทแยกตามโปรไฟล์อัตโนมัติ ปิด-เปิดจอใหม่แล้วการตั้งค่าไม่หาย'
      ],
      fixes: [
        'แก้ไขปัญหาปิดแล้วเปิดจอใหม่แล้วการตั้งค่าบอท (Config) ถูกรีเซ็ต',
        'แก้ไขปัญหาบอทเดินกลับเมืองไปคุยกับช่างตีเหล็กเองแล้วหยุดทำงานโดยไม่ทราบสาเหตุ'
      ]
    },
    {
      version: 'v4.44.5',
      date: '21 ต.ค. 2026',
      title: 'รองรับอัปเดตเกมล่าสุด & แก้กดปุ่มเริ่มบอทซ้ำตอนเดินข้ามแมพ',
      features: [
        'รองรับหน้าต่างร้านค้า คลังเก็บของ และเมนูในเกมเวอร์ชันใหม่ทั้งหมด'
      ],
      fixes: [
        'แก้ไขปัญหาบอทกดปุ่ม Auto เพื่อเริ่มบอทซ้ำๆ ระหว่างกำลังเดินไปแมพเป้าหมายจนค้างเข้าแมพไม่ได้',
        'แก้ไขปัญหาซื้อลูกธนู ซื้อยาบัพ และฝากของเข้าคลังไม่สำเร็จหลังตัวเกมอัปเดตใหม่'
      ]
    },
    {
      version: 'v4.44.4',
      date: '20 ต.ค. 2026',
      title: 'ระบบจำกัด 3 จอต่อ 1 เครื่องอัตโนมัติ & ป้องกันรหัสผ่านเพี้ยน',
      features: [
        'ระบบสุ่มและจำข้อมูลเครื่องอัตโนมัติ จำกัดไม่เกิน 3 จอต่อ 1 เครื่องตามเงื่อนไขใหม่ของเกม'
      ],
      fixes: [
        'แก้ไขปัญหาบางจอค้างหน้าข้อความกำลังโหลดสคริปต์เมื่อเปิดพร้อมกันหลายจอ',
        'แก้ไขปัญหาการบันทึกข้อมูลโปรไฟล์ทับรหัสผ่านเดิมของผู้ใช้งาน'
      ]
    }
  ];

  window.PMHEE_UPDATE_LOGS = UPDATE_LOGS;

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getLatestLog() {
    return UPDATE_LOGS[0] || null;
  }

  function isLatestSeen() {
    const latest = getLatestLog();
    if (!latest) return true;
    try {
      return localStorage.getItem(STORAGE_KEY_SEEN_VER) === latest.version;
    } catch (e) {
      return false;
    }
  }

  function markLatestSeen() {
    const latest = getLatestLog();
    if (!latest) return;
    try {
      localStorage.setItem(STORAGE_KEY_SEEN_VER, latest.version);
    } catch (e) {}
    updateHeaderBadge();
  }

  function injectStyles() {
    if (document.getElementById('pmhee-update-log-styles')) return;
    const style = document.createElement('style');
    style.id = 'pmhee-update-log-styles';
    style.textContent = `
      #btn-update-log {
        position: relative;
        background: linear-gradient(135deg, rgba(168, 85, 247, 0.22), rgba(59, 130, 246, 0.16));
        border: 1px solid rgba(192, 132, 252, 0.45);
        color: #e9d5ff;
        font-weight: 600;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: all 0.2s ease;
      }
      #btn-update-log:hover {
        background: linear-gradient(135deg, rgba(168, 85, 247, 0.35), rgba(59, 130, 246, 0.28));
        border-color: rgba(216, 180, 254, 0.75);
        transform: translateY(-1px);
      }
      .ulog-ver-pill {
        background: rgba(168, 85, 247, 0.28);
        color: #f3e8ff;
        border: 1px solid rgba(192, 132, 252, 0.45);
        padding: 1px 6px;
        border-radius: 999px;
        font-size: 10.5px;
        font-weight: 700;
      }
      .ulog-new-dot {
        background: #ef4444;
        color: #fff;
        font-size: 9.5px;
        font-weight: 800;
        padding: 1px 5px;
        border-radius: 999px;
        box-shadow: 0 0 10px rgba(239, 68, 68, 0.85);
        animation: ulogPulse 1.6s infinite ease-in-out;
      }
      @keyframes ulogPulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.08); opacity: 0.85; }
      }
      #pmhee-update-notify-card {
        position: fixed;
        right: 22px;
        bottom: 22px;
        width: 410px;
        max-width: calc(100vw - 32px);
        background: linear-gradient(145deg, #0f172a 0%, #1e1b4b 100%);
        border: 1.5px solid rgba(192, 132, 252, 0.55);
        border-radius: 14px;
        box-shadow: 0 22px 55px rgba(0, 0, 0, 0.88), 0 0 28px rgba(168, 85, 247, 0.28);
        color: #f8fafc;
        padding: 16px 18px;
        z-index: 99990;
        font-family: inherit;
        animation: ulogSlideIn 0.28s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes ulogSlideIn {
        from { opacity: 0; transform: translateY(18px) scale(0.97); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .ulog-section-box {
        background: rgba(15, 23, 42, 0.65);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 9px;
        padding: 9px 12px;
        margin-top: 8px;
      }
      .ulog-section-title {
        font-size: 11.5px;
        font-weight: 700;
        margin-bottom: 5px;
        display: flex;
        align-items: center;
        gap: 5px;
      }
      .ulog-list {
        margin: 0;
        padding-left: 17px;
        font-size: 11.5px;
        color: #e2e8f0;
        line-height: 1.5;
      }
      .ulog-list li {
        margin-bottom: 3px;
      }
      .ulog-history-card {
        background: rgba(15, 23, 42, 0.75);
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 11px;
        padding: 14px 16px;
      }
      .ulog-history-card.latest {
        border-color: rgba(192, 132, 252, 0.5);
        background: linear-gradient(145deg, rgba(88, 28, 135, 0.18), rgba(15, 23, 42, 0.9));
      }
    `;
    document.head.appendChild(style);
  }

  function updateHeaderBadge() {
    const dot = document.getElementById('update-log-unread-dot');
    if (!dot) return;
    dot.style.display = isLatestSeen() ? 'none' : 'inline-block';
  }

  function renderLogSectionsHtml(entry) {
    const features = Array.isArray(entry.features) ? entry.features : [];
    const fixes = Array.isArray(entry.fixes) ? entry.fixes : [];
    let html = '';
    if (features.length > 0) {
      html += `
        <div class="ulog-section-box" style="border-color: rgba(52, 211, 153, 0.28);">
          <div class="ulog-section-title" style="color: #34d399;">✨ ทำอะไรได้บ้าง</div>
          <ul class="ulog-list">
            ${features.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </div>
      `;
    }
    if (fixes.length > 0) {
      html += `
        <div class="ulog-section-box" style="border-color: rgba(56, 189, 248, 0.28);">
          <div class="ulog-section-title" style="color: #38bdf8;">🛠️ แก้อะไรบ้าง</div>
          <ul class="ulog-list">
            ${fixes.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </div>
      `;
    }
    return html;
  }

  function openUpdateLogModal() {
    markLatestSeen();
    dismissNotifyCard();
    let modal = document.getElementById('modal-update-log');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-update-log';
      modal.className = 'modal-overlay modal';
      modal.style.cssText = 'display: none; align-items: center; justify-content: center; position: fixed; inset: 0; background: rgba(2, 6, 23, 0.82); z-index: 99999; backdrop-filter: blur(5px);';
      modal.innerHTML = `
        <div class="modal-content" style="background: #0b1329; border: 1.5px solid rgba(192, 132, 252, 0.45); border-radius: 14px; width: 660px; max-width: 95vw; max-height: 88vh; display: flex; flex-direction: column; box-shadow: 0 25px 70px rgba(0, 0, 0, 0.95), 0 0 35px rgba(168, 85, 247, 0.22); color: #f8fafc; padding: 20px 22px; font-family: inherit;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 12px; margin-bottom: 14px; flex-shrink: 0;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 38px; height: 38px; border-radius: 10px; background: rgba(168, 85, 247, 0.2); border: 1px solid rgba(192, 132, 252, 0.45); display: flex; align-items: center; justify-content: center; font-size: 20px;">
                🔔
              </div>
              <div>
                <h3 style="margin: 0; font-size: 16.5px; font-weight: 700; color: #f8fafc; display: flex; align-items: center; gap: 8px;">
                  <span>รายการอัปเดตระบบ (Update Log)</span>
                  <span style="font-size: 11px; background: rgba(168, 85, 247, 0.22); color: #e9d5ff; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(192, 132, 252, 0.4); font-weight: 600;">PmheeAether</span>
                </h3>
                <div style="font-size: 11.5px; color: #94a3b8; margin-top: 2px;">สรุปความสามารถใหม่และรายการแก้ไขบั๊กในแต่ละเวอร์ชัน</div>
              </div>
            </div>
            <button type="button" id="btn-update-log-close" style="background: transparent; border: none; color: #94a3b8; font-size: 20px; cursor: pointer; padding: 0 4px; font-weight: bold;">✕</button>
          </div>

          <div id="update-log-history-list" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding-right: 4px;"></div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 14px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.08); flex-shrink: 0;">
            <span style="font-size: 11px; color: #94a3b8;">💡 มีการแจ้งเตือนอัตโนมัติทุกครั้งที่มีเวอร์ชันใหม่</span>
            <button type="button" id="btn-update-log-ok" class="btn btn-primary" style="font-size: 12px; padding: 6px 20px; background: #7c3aed; border-color: #a855f7; font-weight: 600;">รับทราบ / ปิดหน้าต่าง</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#btn-update-log-close').addEventListener('click', () => {
        modal.style.display = 'none';
      });
      modal.querySelector('#btn-update-log-ok').addEventListener('click', () => {
        modal.style.display = 'none';
      });
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
      });
    }

    const listEl = modal.querySelector('#update-log-history-list');
    if (listEl) {
      listEl.innerHTML = UPDATE_LOGS.map((entry, idx) => `
        <div class="ulog-history-card ${idx === 0 ? 'latest' : ''}">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 4px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 13.5px; font-weight: 800; color: #e9d5ff; background: rgba(168, 85, 247, 0.25); border: 1px solid rgba(192, 132, 252, 0.45); padding: 2px 9px; border-radius: 999px;">${escapeHtml(entry.version)}</span>
              ${idx === 0 ? '<span style="font-size: 10.5px; font-weight: 700; background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(52, 211, 153, 0.4); padding: 1px 7px; border-radius: 999px;">เวอร์ชันล่าสุด</span>' : ''}
              <span style="font-size: 13px; font-weight: 700; color: #f8fafc;">${escapeHtml(entry.title || '')}</span>
            </div>
            <span style="font-size: 11px; color: #94a3b8;">📅 ${escapeHtml(entry.date || '')}</span>
          </div>
          ${renderLogSectionsHtml(entry)}
        </div>
      `).join('');
    }

    modal.style.display = 'flex';
  }

  function dismissNotifyCard() {
    const card = document.getElementById('pmhee-update-notify-card');
    if (card) card.remove();
  }

  function showNotifyCardIfNeeded() {
    const latest = getLatestLog();
    if (!latest || isLatestSeen()) return;
    if (document.getElementById('pmhee-update-notify-card')) return;

    const card = document.createElement('div');
    card.id = 'pmhee-update-notify-card';
    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 6px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 20px;">🎉</span>
          <div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 13.5px; font-weight: 800; color: #f8fafc;">อัปเดตใหม่ ${escapeHtml(latest.version)}</span>
              <span class="ulog-new-dot">NEW</span>
            </div>
            <div style="font-size: 11.5px; color: #d8b4fe; font-weight: 600; margin-top: 1px;">${escapeHtml(latest.title || '')}</div>
          </div>
        </div>
        <button type="button" id="btn-ulog-notify-dismiss" title="ปิดแจ้งเตือน" style="background: transparent; border: none; color: #94a3b8; font-size: 16px; cursor: pointer; padding: 0 4px;">✕</button>
      </div>

      ${renderLogSectionsHtml(latest)}

      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.08);">
        <button type="button" id="btn-ulog-notify-all" class="btn btn-secondary btn-sm" style="font-size: 11.5px; padding: 5px 11px;">📜 ดูประวัติทั้งหมด</button>
        <button type="button" id="btn-ulog-notify-ack" class="btn btn-primary btn-sm" style="font-size: 11.5px; padding: 5px 14px; background: #7c3aed; border-color: #a855f7; font-weight: 700;">✅ รับทราบ</button>
      </div>
    `;
    document.body.appendChild(card);

    card.querySelector('#btn-ulog-notify-dismiss').addEventListener('click', () => {
      markLatestSeen();
      dismissNotifyCard();
    });
    card.querySelector('#btn-ulog-notify-ack').addEventListener('click', () => {
      markLatestSeen();
      dismissNotifyCard();
    });
    card.querySelector('#btn-ulog-notify-all').addEventListener('click', () => {
      openUpdateLogModal();
    });
  }

  function initUpdateLogUI() {
    injectStyles();
    const latest = getLatestLog();
    if (!latest) return;

    const headerActions = document.querySelector('.header-actions');
    if (headerActions && !document.getElementById('btn-update-log')) {
      const btn = document.createElement('button');
      btn.id = 'btn-update-log';
      btn.className = 'btn';
      btn.title = 'ดูรายการอัปเดตระบบ (Update Log)';
      btn.innerHTML = `
        <span class="icon" style="font-size: 14px;">🔔</span>
        <span>Update Log</span>
        <span class="ulog-ver-pill">${escapeHtml(latest.version)}</span>
        <span id="update-log-unread-dot" class="ulog-new-dot" style="display: ${isLatestSeen() ? 'none' : 'inline-block'};">ใหม่!</span>
      `;
      btn.addEventListener('click', openUpdateLogModal);

      const refreshBtn = document.getElementById('btn-refresh');
      if (refreshBtn && refreshBtn.parentNode === headerActions) {
        headerActions.insertBefore(btn, refreshBtn);
      } else {
        headerActions.appendChild(btn);
      }
    }

    setTimeout(showNotifyCardIfNeeded, 600);
  }

  window.openUpdateLogModal = openUpdateLogModal;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUpdateLogUI);
  } else {
    initUpdateLogUI();
  }
})();
