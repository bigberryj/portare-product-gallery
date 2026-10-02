<?php
$root=dirname(__DIR__);
$files=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS));
$count=0;
foreach($files as $file){
    if($file->getExtension()!=='php' || strpos($file->getPathname(),DIRECTORY_SEPARATOR.'vendor'.DIRECTORY_SEPARATOR)!==false){continue;}
    $count++; $output=array();$code=0;
    exec(escapeshellarg(PHP_BINARY).' -l '.escapeshellarg($file->getPathname()).' 2>&1',$output,$code);
    echo implode("\n",$output)."\n";
    if($code){exit($code);}
}
echo "PASS: $count PHP files linted\n";
