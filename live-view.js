(() => {
  const panel=document.getElementById('observer-panel');
  if(panel)panel.innerHTML=PicoSources.analyzer;
  const target=document.getElementById('conversion-panel'),card=panel?.querySelector('.conversion-card');
  if(target&&card){
    target.append(card);
    const converter=card.querySelector('#signal-converter');converter.open=true;converter.querySelector('summary').hidden=true;
  }
})();
