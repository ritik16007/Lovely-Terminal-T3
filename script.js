// Lovely Terminal T3 booking, lounge seating and pass management.
const flights = [
  {no:'AI-202',dest:'DELHI (DEL)',gate:'A12',time:'23:45',status:'Boarding'},
  {no:'6E-515',dest:'MUMBAI (BOM)',gate:'B04',time:'00:15',status:'On Time'},
  {no:'UK-981',dest:'BANGALORE (BLR)',gate:'C07',time:'00:50',status:'Delayed'},
  {no:'SG-303',dest:'GOA (GOI)',gate:'A03',time:'01:20',status:'On Time'},
  {no:'AI-102',dest:'DUBAI (DXB)',gate:'D11',time:'02:10',status:'Boarding'},
  {no:'6E-203',dest:'AMRITSAR (ATQ)',gate:'B09',time:'02:45',status:'On Time'},
  {no:'QP-1350',dest:'CHANDIGARH (IXC)',gate:'A01',time:'03:30',status:'On Time'}
];

const LOUNGES = {
  'Economy': {price:999,hours:3},
  'Business': {price:1999,hours:5},
  'First Class': {price:3499,hours:8}
};
const OCCUPIED_SEATS = new Set(['A2','B4','C1']);
const CSV_KEY = 'lovely_terminal_bookings';
const CSV_HEADER = 'PassID,Name,Flight,Phone,Lounge,Seat,Food,Hours,Price,Points,DateTime';
let selectedPrice = 0;
let selectedSeat = '';
let selectedLounge = '';
let tempPayData = null;
let loyaltyPoints = Number.parseInt(localStorage.getItem('lovely_points') || '0',10) || 0;
// CSV export stays locked until the admin login succeeds.
let adminAuthenticated = false;
let deferredInstallPrompt = null;
// Fixed: bookings sync through the user's authenticated Supabase account; only the publishable key belongs in browser code.
const SUPABASE_URL = 'https://ijlcjghdlrurdiaplqft.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_c4jkxrjksfdd94Z8qUs1Yw_Wf8pSRmz';
let syncClient = null;
let syncUser = null;

function setSyncStatus(message){
  const status = document.getElementById('syncMessage');
  if(status) status.textContent = message;
}
function updateSyncButton(){
  const button = document.getElementById('syncAccountBtn');
  if(button) button.textContent = syncUser ? `☁️ Synced: ${syncUser.email}` : '☁️ Sign in to sync';
}
function openSyncModal(){
  const modal = document.getElementById('syncModal');
  if(modal){ modal.style.display='flex'; modal.setAttribute('aria-hidden','false'); }
  const email = document.getElementById('syncEmail');
  if(email && syncUser) email.value = syncUser.email || '';
  setSyncStatus(syncUser ? 'You are signed in. Use this same email on your other device.' : 'Enter your email and we’ll send a one-time sign-in link.');
}
function closeSyncModal(){
  const modal = document.getElementById('syncModal');
  if(modal){ modal.style.display='none'; modal.setAttribute('aria-hidden','true'); }
}
async function requestSyncLink(event){
  event.preventDefault();
  if(!syncClient){ setSyncStatus('Cloud sync is not ready. Refresh the page and try again.'); return; }
  const email = document.getElementById('syncEmail').value.trim();
  const button = document.getElementById('syncSubmit');
  if(button) button.disabled = true;
  setSyncStatus('Sending sign-in link…');
  const {error} = await syncClient.auth.signInWithOtp({email, options:{emailRedirectTo:location.href.split('#')[0]}});
  if(button) button.disabled = false;
  setSyncStatus(error ? `Could not send link: ${error.message}` : `Sign-in link sent to ${email}. Open it on this device, then sign in with the same email on your other device.`);
}
async function loadCloudBookings(){
  if(!syncClient || !syncUser) return;
  const {data,error} = await syncClient.from('lounge_bookings').select('pass_id,booking').eq('user_id',syncUser.id);
  if(error){ console.warn('Cloud booking load failed:',error.message); setSyncStatus(`Cloud connection needs setup: ${error.message}`); return; }
  const merged = new Map(readBookings().map(item=>[item.passId,item]));
  (data || []).forEach(row=>{ if(row.booking?.passId) merged.set(row.pass_id,row.booking); });
  const all = [...merged.values()];
  localStorage.setItem(CSV_KEY,JSON.stringify(all));
  loyaltyPoints = all.reduce((total,item)=>total+(Number(item.points)||0),0);
  localStorage.setItem('lovely_points',String(loyaltyPoints));
  const cloudIds = new Set((data || []).map(row=>row.pass_id));
  const localOnly = all.filter(item=>item.passId && !cloudIds.has(item.passId));
  if(localOnly.length){
    const rows = localOnly.map(booking=>({user_id:syncUser.id,pass_id:booking.passId,booking}));
    const saved = await syncClient.from('lounge_bookings').upsert(rows,{onConflict:'user_id,pass_id'});
    if(saved.error) console.warn('Existing device bookings could not be uploaded:',saved.error.message);
  }
  all.forEach(item=>{ if(item.passId) localStorage.setItem(item.passId,JSON.stringify(item)); });
  updateCSVCount(); updateAdmin();
  setSyncStatus(`${all.length} booking(s) synced to this account.`);
}
async function initializeCloudSync(){
  if(!window.supabase?.createClient){ setSyncStatus('Could not load the cloud sync library. Check your internet connection.'); return; }
  syncClient = window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
  const {data:{session}} = await syncClient.auth.getSession();
  syncUser = session?.user || null; updateSyncButton();
  if(syncUser) await loadCloudBookings();
  syncClient.auth.onAuthStateChange((_event,nextSession)=>{
    syncUser = nextSession?.user || null; updateSyncButton();
    if(syncUser) setTimeout(()=>loadCloudBookings(),0);
  });
}

async function installApp(){
  if(deferredInstallPrompt){
    await deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    if(choice.outcome === 'accepted') document.getElementById('installAppBtn').textContent = '✅ App Installed';
    return;
  }
  const isInstalled = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if(isInstalled){ alert('Lovely Terminal T3 is already installed on this device.'); return; }
  alert('To add Lovely Terminal T3 to your phone:\n\nAndroid: open the browser menu (⋮) and choose Install app or Add to Home screen.\niPhone: open this page in Safari, tap Share, then Add to Home Screen.');
}

window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();
  deferredInstallPrompt=event;
});
window.addEventListener('appinstalled',()=>{
  const button=document.getElementById('installAppBtn');
  if(button){button.textContent='✅ App Installed';button.disabled=true;}
  deferredInstallPrompt=null;
});

function readBookings(){
  try { const value = JSON.parse(localStorage.getItem(CSV_KEY) || '[]'); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function escapeHTML(value){
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function csvCell(value){ return '"' + String(value ?? '').replace(/"/g,'""') + '"'; }

// Flight search checks both flight number and destination, together with the selected status.
function renderFlights(){
  const query = (document.getElementById('searchFlight')?.value || '').trim().toLowerCase();
  const status = document.getElementById('filterStatus')?.value || 'all';
  const body = document.getElementById('flightBody');
  if(!body) return;
  body.replaceChildren();
  flights.filter(f => (f.no.toLowerCase().includes(query) || f.dest.toLowerCase().includes(query)) && (status === 'all' || f.status === status)).forEach(f => {
    const cls = f.status === 'On Time' ? 'on-time' : f.status === 'Boarding' ? 'boarding' : 'delayed';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><b>${escapeHTML(f.no)}</b></td><td>${escapeHTML(f.dest)}</td><td>${escapeHTML(f.gate)}</td><td>${escapeHTML(f.time)}</td><td><span class="status ${cls}">${escapeHTML(f.status)}</span></td><td><button class="btn btn-primary" type="button" data-flight="${escapeHTML(f.no)}">Select</button></td>`;
    tr.querySelector('button').addEventListener('click', () => useFlight(f.no));
    body.appendChild(tr);
  });
}
function useFlight(no){
  const input = document.getElementById('pFlight');
  if(input) input.value = no;
  document.querySelector('.lounge-section')?.scrollIntoView({behavior:'smooth',block:'start'});
}

function setLounge(name, card){
  const config = LOUNGES[name];
  if(!config) return false;
  if(selectedLounge && selectedLounge !== name){
    selectedSeat = '';
    const seatInput = document.getElementById('pSeat');
    if(seatInput) seatInput.value = '';
    const notice = document.getElementById('seatNotice');
    if(notice) notice.textContent = '';
  }
  selectedLounge = name;
  selectedPrice = config.price;
  document.querySelectorAll('.lounge').forEach(el => el.classList.toggle('active', el === card || (!card && el.dataset.lounge === name)));
  const loungeSelect = document.getElementById('pLoungeType');
  const hoursSelect = document.getElementById('pHours');
  if(loungeSelect) loungeSelect.value = name;
  if(hoursSelect) hoursSelect.value = String(config.hours);
  return true;
}
function selectLounge(name, _price, el){ setLounge(name,el); }
function handleLoungeChange(name){
  const card = [...document.querySelectorAll('.lounge')].find(el => el.dataset.lounge === name);
  if(name && setLounge(name,card)){
    selectedSeat = '';
    document.getElementById('pSeat').value = '';
  }
}

// Auto-assign a random available seat when the customer clicks Choose Seat.
function openSeatMap(event,name,price,button){
  if(event){ event.preventDefault(); event.stopPropagation(); }
  // Backward compatibility: the supplied original HTML calls openSeatMap(event)
  // without lounge arguments. Recover the clicked lounge from its containing card.
  const card = button?.closest('.lounge') || event?.target?.closest?.('.lounge') || event?.currentTarget?.closest?.('.lounge');
  if(!name && card){
    name = card.dataset.lounge || [...document.querySelectorAll('.lounge')].find(el => el === card)?.querySelector('h3')?.textContent || '';
    name = name.includes('Economy') ? 'Economy' : name.includes('Business') ? 'Business' : name.includes('First Class') ? 'First Class' : '';
    price = LOUNGES[name]?.price;
  }
  if(!setLounge(name,card)) return;
  const allSeats = ['A','B','C','D','E','F'].flatMap(row => [1,2,3,4].map(col => `${row}${col}`));
  const alreadyBooked = new Set(readBookings().map(booking => booking.seat).filter(seat => seat && seat !== 'Not Assigned'));
  const availableSeats = allSeats.filter(seat => !OCCUPIED_SEATS.has(seat) && !alreadyBooked.has(seat));
  if(!availableSeats.length){
    const notice = document.getElementById('seatNotice');
    if(notice) notice.textContent = 'No available seats right now. Please contact the lounge desk.';
    return;
  }
  const randomSeat = availableSeats[Math.floor(Math.random() * availableSeats.length)];
  selectedSeat = randomSeat;
  document.getElementById('pSeat').value = randomSeat;
  const notice = document.getElementById('seatNotice');
  if(notice) notice.textContent = `Your seat has been assigned: ${randomSeat}`;
  const modal = document.getElementById('seatModal');
  if(modal){ modal.style.display = 'none'; modal.setAttribute('aria-hidden','true'); }
}
function chooseSeat(seatNo,seatElement){
  selectedSeat = seatNo;
  document.getElementById('pSeat').value = seatNo;
  document.querySelectorAll('#seatGrid .seat').forEach(el => el.classList.remove('selected'));
  seatElement.classList.add('selected');
  // Fixed: show the selection briefly so the customer sees confirmation, then close after 400 ms.
  window.setTimeout(closeSeatMap,400);
}
function closeSeatMap(){
  const modal = document.getElementById('seatModal');
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden','true');
  if(selectedSeat) document.getElementById('pSeat').value = selectedSeat;
}

function openPayment(){
  const name = document.getElementById('pName').value.trim();
  const flight = document.getElementById('pFlight').value.trim().toUpperCase();
  const phone = document.getElementById('pPhone').value.trim();
  const lounge = document.getElementById('pLoungeType').value;
  const seat = document.getElementById('pSeat').value.trim();
  if(!name || !flight || !phone || !lounge){ alert('Please enter your name, flight, phone number and lounge.'); return; }
  if(!flights.some(f => f.no === flight)){ alert('Select a valid flight from the departure board.'); return; }
  if(!LOUNGES[lounge]){ alert('Choose a lounge before continuing.'); return; }
  if(!seat || seat !== selectedSeat || OCCUPIED_SEATS.has(seat)){ alert('Choose an available lounge seat before payment.'); return; }
  const foods = [...document.querySelectorAll('.food:checked')].map(input => {
    const [food,amount] = input.value.split('-'); return {name:food,price:Number(amount)};
  });
  const foodPrice = foods.reduce((sum,item) => sum + item.price,0);
  selectedPrice = LOUNGES[lounge].price;
  const total = selectedPrice + foodPrice;
  tempPayData = {name,flight,phone,lounge,seat,foods:foods.map(x=>x.name).join(', ') || 'None',foodPrice,total,hours:LOUNGES[lounge].hours};
  document.getElementById('payAmount').textContent = `Total: ₹${total.toLocaleString('en-IN')}  (Lounge ₹${selectedPrice.toLocaleString('en-IN')} + Food ₹${foodPrice.toLocaleString('en-IN')})`;
  const modal = document.getElementById('payModal');
  modal.style.display = 'flex'; modal.setAttribute('aria-hidden','false');
}
function closePayment(){ const modal=document.getElementById('payModal'); modal.style.display='none'; modal.setAttribute('aria-hidden','true'); }
function confirmPayment(){
  if(!tempPayData) return;
  closePayment();
  generatePass();
}

function generatePass(){
  if(!tempPayData) return;
  const passId = `LOVELY-T3-${Math.floor(1000 + Math.random()*9000)}`;
  const created = new Date().toLocaleString();
  // Fixed: points are based on the validated final amount, including lounge and food, and never zero for a paid pass.
  const points = Math.max(1,Math.floor(tempPayData.total/10));
  loyaltyPoints += points;
  localStorage.setItem('lovely_points',String(loyaltyPoints));
  const data = {passId,...tempPayData,hrs:tempPayData.hours,price:tempPayData.total,points,created};
  localStorage.setItem(passId,JSON.stringify(data));
  saveToCSVStorage(data);
  document.getElementById('passId').textContent = passId;
  document.getElementById('rName').textContent = data.name;
  document.getElementById('rFlight').textContent = data.flight;
  document.getElementById('rLounge').textContent = data.lounge;
  document.getElementById('rSeat').textContent = data.seat;
  document.getElementById('rFood').textContent = data.foods;
  document.getElementById('rHours').textContent = `${data.hrs} Hours`;
  document.getElementById('rPrice').textContent = `₹${data.price.toLocaleString('en-IN')}`;
  document.getElementById('rPoints').textContent = `${points} points`;
  document.getElementById('rTime').textContent = created;
  const qr = document.getElementById('qrcode'); qr.replaceChildren();
  try {
    if(typeof QRCode !== 'undefined') new QRCode(qr,{text:JSON.stringify({id:passId,flight:data.flight,seat:data.seat}),width:100,height:100,correctLevel:QRCode.CorrectLevel?.M});
    else qr.textContent = passId;
  } catch { qr.textContent = passId; }
  document.getElementById('passCard').style.display = 'block';
  document.getElementById('noPass').style.display = 'none';
  updateCSVCount();
  document.getElementById('passCard').scrollIntoView({behavior:'smooth',block:'center'});
  tempPayData = null;
}

function saveToCSVStorage(data){
  const bookings = readBookings();
  bookings.push(data);
  localStorage.setItem(CSV_KEY,JSON.stringify(bookings));
  updateCSVCount(); updateAdmin();
  // Fixed: keep local-first behavior, then sync this pass to the signed-in account in the cloud.
  if(syncClient && syncUser) syncClient.from('lounge_bookings').upsert({user_id:syncUser.id,pass_id:data.passId,booking:data},{onConflict:'user_id,pass_id'}).then(({error})=>{
    if(error){ console.warn('Booking cloud sync failed:',error.message); setSyncStatus(`Booking saved on this device; cloud sync failed: ${error.message}`); }
    else setSyncStatus('Booking saved and synced to your account.');
  });
}
function getCSVString(){
  const rows = readBookings().map(b => [b.passId,b.name,b.flight,b.phone,b.lounge,b.seat,b.food ?? b.foods,b.hrs ?? b.hours,b.price,b.points,b.created].map(csvCell).join(','));
  return CSV_HEADER + (rows.length ? `\r\n${rows.join('\r\n')}` : '');
}
function downloadCSV(){
  const adminPanel = document.getElementById('adminPanel');
  if(!adminAuthenticated || !adminPanel || adminPanel.style.display !== 'block'){
    alert('Please log in to the Admin Portal to download booking data.');
    return;
  }
  const rows = readBookings();
  if(!rows.length){ alert('No booking records found. Generate a lounge pass first.'); return; }
  const blob = new Blob([getCSVString()],{type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href=url; a.download='Lovely_Terminal_T3_Bookings.csv'; a.click(); URL.revokeObjectURL(url);
}
function updateCSVCount(){
  const bookings = readBookings();
  const count = document.getElementById('csvCount');
  if(count) count.textContent = `${bookings.length} booking record(s) · Loyalty balance: ${loyaltyPoints} points`;
  const badge = document.getElementById('loyaltyBadge');
  if(badge) badge.textContent = `⭐ ${loyaltyPoints} Loyalty Points`;
}
function verifyPass(){
  const id = document.getElementById('verifyInput').value.trim();
  const result = document.getElementById('verifyResult');
  let data = null;
  try { data = id ? JSON.parse(localStorage.getItem(id) || 'null') : null; } catch {}
  result.textContent = data ? `✓ Valid Lounge Access Pass: ${data.name} | Flight: ${data.flight} | Seat: ${data.seat}` : '✗ Invalid or expired pass.';
  result.className = data ? 'verify-valid' : 'verify-invalid';
}

function toggleAdmin(){
  const panel = document.getElementById('adminPanel');
  if(panel.style.display === 'block'){ panel.style.display='none'; adminAuthenticated=false; return; }
  const modal = document.getElementById('adminLoginModal');
  modal.style.display='flex'; modal.setAttribute('aria-hidden','false');
  document.getElementById('adminPassword').focus();
}
function closeAdminLogin(){ const modal=document.getElementById('adminLoginModal'); modal.style.display='none'; modal.setAttribute('aria-hidden','true'); }
function adminLogin(event){
  event.preventDefault();
  const password = document.getElementById('adminPassword').value;
  if(password !== 'admin123'){
    document.getElementById('adminLoginError').textContent = 'Incorrect password. Try again.';
    return;
  }
  document.getElementById('adminLoginError').textContent='';
  document.getElementById('adminPassword').value=''; closeAdminLogin();
  adminAuthenticated=true;
  const panel=document.getElementById('adminPanel'); panel.style.display='block';
  updateAdmin(); panel.scrollIntoView({behavior:'smooth',block:'start'});
}
function updateAdmin(){
  try {
    const bookings=readBookings();
    document.getElementById('totalBookings').textContent=bookings.length;
    document.getElementById('totalRevenue').textContent='₹'+bookings.reduce((s,x)=>s+(Number(x.price)||0),0).toLocaleString('en-IN');
    const countByLounge=new Map(); bookings.forEach(x=>countByLounge.set(x.lounge,(countByLounge.get(x.lounge)||0)+1));
    document.getElementById('popularLounge').textContent=countByLounge.size?[...countByLounge.entries()].sort((a,b)=>b[1]-a[1])[0][0]:'-';
    document.getElementById('totalPoints').textContent=bookings.reduce((s,x)=>s+(Number(x.points)||0),0);
    const canvas=document.getElementById('revenueChart');
    if(canvas && typeof Chart!=='undefined'){
      if(window.myChart) window.myChart.destroy();
      window.myChart=new Chart(canvas,{type:'bar',data:{labels:['Economy','Business','First Class'],datasets:[{label:'Bookings by Lounge',data:['Economy','Business','First Class'].map(name=>bookings.filter(x=>x.lounge===name).length),backgroundColor:['#ffcc00','#00d2ff','#a8ff78']}]},options:{responsive:true,plugins:{legend:{labels:{color:'#fff'}}},scales:{x:{ticks:{color:'#fff'}},y:{beginAtZero:true,ticks:{precision:0,color:'#fff'}}}}});
    }
  } catch(error){ console.error('Could not update admin statistics',error); }
}

function addLost(){
  const input=document.getElementById('lostItem'); const value=input.value.trim();
  if(!value){ alert('Enter a description of the lost item.'); return; }
  let items=[]; try{items=JSON.parse(localStorage.getItem('lovely_lost')||'[]');if(!Array.isArray(items))items=[];}catch{}
  items.push({description:value,created:new Date().toLocaleString()});
  localStorage.setItem('lovely_lost',JSON.stringify(items)); renderLost(); input.value='';
}
function renderLost(){
  let items=[];try{items=JSON.parse(localStorage.getItem('lovely_lost')||'[]');if(!Array.isArray(items))items=[];}catch{}
  const list=document.getElementById('lostList'); if(!list)return; list.replaceChildren();
  items.forEach(item=>{const li=document.createElement('li'); const description=typeof item==='string'?item:`${item.description} - Reported on ${item.created}`; li.textContent=`• ${description}`;list.appendChild(li);});
}
function toggleTheme(){
  document.body.classList.toggle('light');
  const button=document.getElementById('themeBtn'); button.textContent=document.body.classList.contains('light')?'☀️':'🌙';
}
function changeLang(){ /* Language selector retained for the current English interface. */ }
function tick(){
  const now=new Date();
  const live=document.getElementById('liveBox'); const weather=document.getElementById('weatherBox');
  if(live) live.textContent=`${now.toLocaleDateString('en-US',{weekday:'short',day:'2-digit',month:'short'})} | ${now.toLocaleTimeString()} | T3`;
  if(weather) weather.textContent='Delhi 22°C Clear | Mumbai 28°C Humid';
}
window.addEventListener('DOMContentLoaded',()=>{
  tick(); window.setInterval(tick,1000); renderFlights(); updateCSVCount(); renderLost();
  initializeCloudSync().catch(error=>{console.error('Cloud sync initialization failed:',error);setSyncStatus('Cloud sync could not start. Refresh and try again.');});
  if('serviceWorker' in navigator && location.protocol !== 'file:'){
    navigator.serviceWorker.register('./service-worker.js').catch(error=>console.warn('Offline app setup failed',error));
  }
  document.querySelectorAll('.lounge').forEach((card,index)=>card.dataset.lounge=['Economy','Business','First Class'][index]);
  document.querySelectorAll('.modal').forEach(modal=>modal.addEventListener('click',event=>{if(event.target===modal){modal.style.display='none';modal.setAttribute('aria-hidden','true');}}));
});
