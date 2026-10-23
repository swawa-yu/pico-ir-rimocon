(() => {
  'use strict';
  function command(workspace, selectedId, parts, displayId, values = {}, surface = null) {
    const screen = parts.find(p => p.id === displayId && p.kind === 'ssd1306');
    if (!screen) throw Error('SSD1306を部品設定に追加してください。');
    const enabled = b => b.isEnabled() && !b.getInheritedDisabled();
    const isDisplay = b => ['pico_display_text', 'pico_display_clear', 'pico_display_pixel', 'pico_display_fill', 'pico_display_text_at', 'pico_display_show'].includes(b.type);
    let block = workspace.getBlockById(selectedId);
    while (block && !isDisplay(block)) block = block.getParent();
    if (block && (!enabled(block) || block.getFieldValue('PART') !== displayId)) block = null;
    if (!block) {
      const candidates = workspace.getAllBlocks(true).filter(b => isDisplay(b) && enabled(b) && b.getFieldValue('PART') === displayId);
      block = candidates.find(b => b.type === 'pico_display_text') || candidates[0];
    }
    if (!block) throw Error('表示・消去ブロックを「実行したとき」につないでください。');
    function value(b) {
      if (!b) throw Error('表示内容と行番号を入力してください。');
      if (b.type === 'text') return b.getFieldValue('TEXT');
      if (b.type === 'pico_display_get_pixel') {
        if (!surface || b.getFieldValue('PART') !== displayId) throw Error('同じ画面のピクセルを指定してください。');
        return surface.pixel(value(b.getInputTargetBlock('X')), value(b.getInputTargetBlock('Y')));
      }
      if (b.type === 'pico_dip_value' || b.type === 'pico_dip_on') {
        const n = Number(values[b.getFieldValue('PART')] ?? 0);
        if (!Number.isInteger(n) || n < 0 || n > 255) throw Error('DIPスイッチの値は0〜255の整数にしてください。');
        if (b.type === 'pico_dip_value') return n;
        const index = value(b.getInputTargetBlock('NUMBER'));
        if (!Number.isInteger(index) || index < 1 || index > 8) throw Error('スイッチ番号は1〜8にしてください。');
        return Boolean(n & (1 << (index - 1)));
      }
      if (b.type === 'math_number') return Number(b.getFieldValue('NUM'));
      if (b.type === 'math_arithmetic') {
        const a = value(b.getInputTargetBlock('A')), c = value(b.getInputTargetBlock('B'));
        const operations = {ADD: () => a+c, MINUS: () => a-c, MULTIPLY: () => a*c, DIVIDE: () => a/c, POWER: () => a**c};
        return operations[b.getFieldValue('OP')]();
      }
      throw Error('画面のプレビューは文字・数値・計算式・DIPスイッチに対応しています。');
    }
    if (block.type === 'pico_display_clear') return {clear: true};
    if (block.type === 'pico_display_show') return {op:'show'};
    const color = () => {
      const n = value(block.getInputTargetBlock('COLOR'));
      if (n !== 0 && n !== 1) throw Error('ピクセルの値は0か1にしてください。');
      return n;
    };
    if (block.type === 'pico_display_fill') return {op:'fill',value:color()};
    if (['pico_display_pixel', 'pico_display_text_at'].includes(block.type)) {
      const x = value(block.getInputTargetBlock('X')), y = value(block.getInputTargetBlock('Y'));
      if (!Number.isInteger(x) || !Number.isInteger(y) || x<0 || x>=screen.width || y<0 || y>=screen.height) throw Error(`座標はx:0〜${screen.width-1}、y:0〜${screen.height-1}の整数にしてください。`);
      if (block.type === 'pico_display_pixel') return {op:'pixel',x,y,value:color()};
      const text = String(value(block.getInputTargetBlock('TEXT')));
      if (/[^\x20-\x7e]/.test(text)) throw Error('画面の文字は半角英数字・記号を使ってください。');
      return {op:'text',x,y,text};
    }
    const row = value(block.getInputTargetBlock('LINE'));
    const v = value(block.getInputTargetBlock('TEXT'));
    const text = typeof v === 'boolean' ? (v ? 'True' : 'False') : String(v);
    if (!Number.isInteger(row) || row < 1 || row > screen.height / 8) throw Error(`行番号は1〜${screen.height / 8}にしてください。`);
    if (/[^\x20-\x7e]/.test(text)) throw Error('画面の文字は半角英数字・記号を使ってください。');
    return {row, text};
  }
  class Surface {
    constructor(width,height,font){
      this.width=width;this.height=height;this.font=font;
      this.buffer=new Uint8Array(width*height);this.visible=this.buffer.slice();
    }
    pixel(x,y,value){
      if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||x>=this.width||y<0||y>=this.height)throw Error('ピクセルの座標が画面外です。');
      const index=y*this.width+x;
      if(value===undefined)return this.buffer[index];
      if(value!==0&&value!==1)throw Error('ピクセルの値は0か1にしてください。');
      this.buffer[index]=value;
    }
    text(text,x,y){
      Array.from(text).forEach((c,i)=>{
        const offset=(c.charCodeAt(0)-32)*8;
        for(let dx=0;dx<8;dx++)for(let dy=0;dy<8;dy++)if(x+i*8+dx<this.width&&y+dy<this.height&&(this.font[offset+dx]&(1<<dy)))this.pixel(x+i*8+dx,y+dy,1);
      });
    }
    show(){this.visible.set(this.buffer);}
    get dirty(){return this.buffer.some((v,i)=>v!==this.visible[i]);}
    apply(command){
      if(command.clear){this.buffer.fill(0);this.show();}
      else if(command.op==='show')this.show();
      else if(command.op==='fill')this.buffer.fill(command.value);
      else if(command.op==='pixel')this.pixel(command.x,command.y,command.value);
      else if(command.op==='text')this.text(command.text,command.x,command.y);
      else{
        const y=(command.row-1)*8;
        this.buffer.fill(0,y*this.width,(y+8)*this.width);
        this.text(command.text,0,y);this.show();
      }
    }
  }
  const api = {command,Surface};
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.DisplayPreview = api;
})();
