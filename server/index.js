const express=require('express');
const fs=require('fs');
const path=require('path');

const app=express();
const DATA_FILE=path.join(__dirname,'data.json');

app.use(require('cors')())
app.use(express.json());

app.post('/report',(req,res)=>{
    const items=req.body;
    console.log(`received ${items.length} items`)
    const existing=readData()
    existing.push(...items)
    writeData(existing)

    res.json({success:true})
})

app.get('/report/data',(req,res)=>{
    res.json(readData())
})

app.listen(3001,()=>{
    console.log('server started on port 3001')
})

function readData(){
    try{
        return JSON.parse(fs.readFileSync(DATA_FILE,'utf-8'))
    }catch(e){
        return []
    }
}

function writeData(data){ 
    fs.writeFileSync(DATA_FILE,JSON.stringify(data))
}