# Coleta local agendada (Agendador de Tarefas do Windows) das fontes marcadas `bloqueado_no_ci: true`
# em collector/config.yaml — sites que devolvem 403 ao IP do GitHub Actions (hoje: Colodete).
# Faz git pull, roda o coletor só para essas fontes (o main.py mantém os registros das outras) e faz
# commit + push se os dados mudaram. Saída em coleta-local.log na raiz do repositório.
#
# Agendar (PowerShell do usuário atual, sem administrador; ajuste o caminho):
#   $acao = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\caminho\aysha-leiloes\scripts\coleta-local.ps1"
#   $gatilho = New-ScheduledTaskTrigger -Daily -At 07:30
#   $opcoes = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
#   Register-ScheduledTask -TaskName "aysha-leiloes coleta local" -Action $acao -Trigger $gatilho -Settings $opcoes -Description "Coleta das fontes bloqueadas no CI (Aysha Leilões)"
# 07:30 de Brasília fica depois da coleta do Action (06:00), então o pull já traz a base do dia.
#
# PowerShell 5.1: não usar "2>&1" em comandos nativos com $ErrorActionPreference = 'Stop' (o git escreve
# no stderr mensagens normais). A saída passa pelo cmd.exe.

$ErrorActionPreference = 'Continue'
$raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $raiz
$log = Join-Path $raiz 'coleta-local.log'

function Registrar([string] $texto) { $texto | Out-File -Append -Encoding utf8 $log }
function Rodar([string] $comando) {
  $saida = cmd /c "$comando 2>&1"
  if ($saida) { $saida | Out-File -Append -Encoding utf8 $log }
  return $LASTEXITCODE
}

# Python: o PATH da tarefa agendada pode não ter o python; tenta o do usuário.
$python = 'python'
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  $candidato = Get-ChildItem "$env:LOCALAPPDATA\Python\pythoncore-*\python.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($candidato) { $python = $candidato.FullName }
}

Registrar "=== $(Get-Date -Format 'yyyy-MM-dd HH:mm') ==="
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Registrar 'git não encontrado no PATH.'; exit 1 }

if ((Rodar 'git pull --rebase origin main') -ne 0) { Registrar 'git pull falhou; abortando (resolva o repositório local).'; exit 1 }

$fontes = cmd /c "`"$python`" -X utf8 -c `"import yaml;c=yaml.safe_load(open('collector/config.yaml',encoding='utf-8'));print(','.join(n for n,f in c['fontes'].items() if f.get('ativa') and f.get('bloqueado_no_ci')))`""
if (-not $fontes) { Registrar 'Nenhuma fonte bloqueada no CI; nada a fazer.'; exit 0 }
Registrar "Fontes: $fontes"

$codigo = Rodar "`"$python`" -X utf8 -m collector.main --fontes $fontes"
if ($codigo -ne 0) { Registrar "coletor saiu com código $codigo (ver acima); segue para commitar o que houver." }

cmd /c 'git diff --quiet -- docs/data/imoveis*.json docs/data/historico.json docs/data/status_fontes.json collector/cache'
if ($LASTEXITCODE -eq 0) { Registrar 'Sem mudanças nos dados.'; exit 0 }

Rodar 'git add -A docs/data collector/cache' | Out-Null
if ((Rodar "git commit -m ""dados: coleta local $(Get-Date -Format 'yyyy-MM-dd HH:mm')""") -ne 0) { Registrar 'Nada a commitar.'; exit 0 }
for ($tentativa = 1; $tentativa -le 3; $tentativa++) {
  if ((Rodar 'git push origin main') -eq 0) { Registrar 'Enviado.'; exit 0 }
  Registrar "push rejeitado (tentativa $tentativa); tenta rebase."
  if ((Rodar 'git pull --rebase origin main') -ne 0) {
    # conflito nos JSON de dados: fica com a versão remota e refaz a coleta local por cima
    Rodar 'git rebase --abort' | Out-Null
    Rodar 'git reset --hard origin/main' | Out-Null
    Rodar "`"$python`" -X utf8 -m collector.main --fontes $fontes" | Out-Null
    Rodar 'git add -A docs/data collector/cache' | Out-Null
    Rodar "git commit -m ""dados: coleta local $(Get-Date -Format 'yyyy-MM-dd HH:mm')""" | Out-Null
  }
}
Registrar 'push falhou três vezes; commit fica local.'
exit 1
