/** Real HTTP/MCP/model acceptance; private process URL and cookie remain in memory. */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { openAsBlob } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { setTimeout as pause } from 'node:timers/promises'
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const WebSocket = require('ws')
const log = await readFile('tmp/axisverse-server.log', 'utf8')
const launch = /dsh web: (http:\/\/[^\s]+)/.exec(log)?.[1]
if (!launch) throw new Error('Web service is not ready')
const auth = await fetch(launch, { redirect: 'manual' })
const cookie = auth.headers.get('set-cookie')?.split(';')[0]
if (!cookie) throw new Error(`Authentication failed: ${auth.status}`)
const origin = new URL(launch).origin
const headers = { cookie }
async function rpc(method, request) {
  const r = await fetch(`${origin}/api/${method}`, { method:'POST', headers:{...headers,'content-type':'application/json'},
    body:JSON.stringify({type:'client-request',rpcId:randomUUID(),method,payload:{args:{request}}}) })
  const j=await r.json()
  if(!r.ok || !j.result?.ok) throw new Error(`${method}: ${JSON.stringify(j)}`)
  return j.result.value
}
async function readPage(sessionId) {
  const streamId=randomUUID()
  const socket=new WebSocket(`${origin.replace(/^http/,'ws')}/api/remote.mux`,{headers})
  const cursor=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Session opening timeout')),15000)
    socket.on('error',reject)
    socket.on('open',()=>socket.send(JSON.stringify({type:'open',streamId,endpoint:'session/follow',payload:{args:{request:{address:{kind:'session',sessionId}}}}})))
    socket.on('message',bytes=>{const f=JSON.parse(bytes.toString());if(f.type==='item'&&f.value?.type==='snapshot'){clearTimeout(timer);resolve(f.value.cursor)} if(f.type==='error'){clearTimeout(timer);reject(new Error(JSON.stringify(f.error)))}})
  }).finally(()=>socket.close())
  return rpc('session/page',{address:{kind:'session',sessionId},throughSeq:cursor,maxMessages:100})
}
await mkdir('tmp/acceptance',{recursive:true})
const statePath='tmp/acceptance/state.json'
let state
try {state=JSON.parse(await readFile(statePath,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error;state={}}
if(!state.material){
  const r=await fetch(`${origin}/api/axisverse/materials/upload`,{method:'POST',headers:{...headers,'content-type':'application/pdf','X-Material-Name':encodeURIComponent('高等数学学习教材.pdf')},body:await openAsBlob(process.argv[2]||'../资料/高等数学（下册） (同济大学数学科学学院) (Z-Library).pdf')})
  if(!r.ok)throw new Error(`Upload failed ${r.status}: ${await r.text()}`)
  state.material=await r.json();await writeFile(statePath,JSON.stringify(state))
  console.log('Original textbook stored; waiting for searchable text')
}
for(let i=0;i<400;i++){
  const r=await fetch(`${origin}/api/axisverse/materials/uploads/${state.material.uploadId||state.material.id}`,{headers})
  const j=await r.json();if(!r.ok)throw new Error(JSON.stringify(j))
  if(j.phase==='failed')throw new Error(`Material processing failed: ${j.errorCode}`)
  if(j.phase==='ready'){state.material=j;break}
  if(i%20===0)console.log('Material phase:',j.phase)
  await pause(1500)
}
if(!state.material.searchable)throw new Error('Material did not become searchable')
console.log('PASS: upload ready',state.material.id)
if(!state.sessionId){state.sessionId=(await rpc('session/create',{agentPreset:'axisverse'})).sessionId;await writeFile(statePath,JSON.stringify(state))}
const name=`[高等数学学习教材.pdf](${origin}/api/axisverse/materials/${state.material.id}/file)`
const prompts=[
  `我是南京理工大学软件工程专业的学生，刚上传${name}，但不知道应该重点复习哪些内容。请主动检索上传教材，以及共享资料中的2023年高等数学II试卷题目索引。用表格列出重点模块、试卷依据和学习建议，再给出三个阶段的学习目标。重点说明重积分，控制在600字以内，标注资料来源。请实际查阅资料后回答。`,
  '请讲解2023年高等数学II试卷第六题：计算三重积分 ∭Ω (x+z)dV，其中Ω为曲面 z=√(x²+y²) 与z=2所围闭区域。先检索真题索引和教学补充推导，再查教材三重积分方法。所有search_course_material调用显式传school=南京理工大学、major=软件工程。按理解区域、选择坐标、积分限、计算、易错点讲解，解释为什么x项积分为零及体积元为什么乘r。补充推导不是官方解析。最后给一道只改变上界高度的练习，先不给答案。',
  '如果把上界改成z=3，我算得81π/4，是否正确？请检查结果，并总结这类圆锥区域积分题的三个关键步骤。',
]
for(let index=state.completed||0;index<prompts.length;index++){
  const before=await readPage(state.sessionId)
  const previous=new Set(before.records?.map(x=>x.event?.seq)??[])
  await rpc('session/prompt',{requestId:randomUUID(),sessionId:state.sessionId,mode:'queue',content:[{type:'text',text:prompts[index]}]})
  console.log('Model round started:',index+1)
  let page,finished=false
  for(let n=0;n<150;n++){
    await pause(2000);page=await readPage(state.sessionId)
    const fresh=(page.records||[]).filter(x=>!previous.has(x.event?.seq))
    const end=fresh.find(x=>x.event?.type==='turn/end')
    if(end){if(end.event.data.reason?.kind!=='completed'){await writeFile(`tmp/acceptance/failed-round-${index+1}.json`,JSON.stringify(page,null,2));throw new Error(`Turn stopped: ${JSON.stringify(end.event.data.reason)}`)}finished=true;break}
    if(n%15===0)console.log('Waiting for model/tools, round',index+1)
  }
  await writeFile(`tmp/acceptance/round-${index+1}.json`,JSON.stringify(page,null,2))
  if(!finished)throw new Error('Model round timed out')
  state.completed=index+1;await writeFile(statePath,JSON.stringify(state))
  console.log('PASS: completed model round',index+1)
}
console.log('Acceptance traces saved in tmp/acceptance; inspect evidence before publishing.')
