# Input Method Observer

[![Input Method Observer](https://appsweets.net/input-method-observer/imo.png)](https://appsweets.net/input-method-observer/imo.mp4)

Input Method Observer (以下 IMO) はインプットメソッドの状態をアクティブな要素の近くに表示したり、状態を喋ったりする Chrome 用の拡張です。
ブラウザ上でいざ何か打ち込んだら「いんぷめてょどせゔぇr」のようになってしまうインシデントを回避するためのものです。

Chrome 用の拡張としては [IME State Visible](https://chrome.google.com/webstore/detail/ime-state-visible/mnbmnhpnniahlicddcllehggdjglfkeh) がすでにありますが、
これは実質的に Windows 用であるために、その Linux 版として作られました。

* 主に Linux 向けです
* ibus / fcitx5 に対応しています
* mozc / skk で動作を確認しています

## インストール

### 想定環境

IMO は現在 Linux 上で動作します。また開発とテストは Ubuntu 上で行っています。

IMO は主に 2 つのパートで構成されます。これは、Chrome にインプットメソッドの状態をレポートする機能がないためです。

* ローカルで動作するオブザーバースクリプト: インプットメソッドに関する D-Bus 上のシグナルを購読し、同時に WebSocket
  サーバとして振る舞います。このスクリプトは systemd に登録されたソケットユニットからオンデマンドに起動されます
* Chrome に登録する拡張: オブザーバースクリプトと接続し、得たインプットメソッドの情報を表示します

### オブザーバースクリプトのインストール

まず [Node.js](http://nodejs.org) が必要です。v18 くらいあれば動くと思います。

任意のディレクトリに IMO の git リポジトリをクローンし（以下、このローカルのリポジトリを `<リポジトリ>` と記述します）、npm を用いてインストールします。

```bash
$ git clone https://github.com/akahuku/input-method-observer.git
$ cd input-method-observer
$ npm install
```

`npm install` により必要なモジュールがインストールされます。また、オンデマンドにオブザーバースクリプトを起動するための systemd ソケットおよびサービスが `~/.config/systemd/user/input-method-observer.*` として配置されます。

`<リポジトリ>/bin/input-method-observer-client` でスクリプトが正常に起動するかをテストできます。
正常に起動している場合（つまり、ソケットアクティベーションによるスクリプトの起動、WebSocket サーバとしての動作、
および D-Bus の購読とがすべて正常に動作している場合）、テストスクリプトの実行中にインプットメソッドを切り替えたり、入力モードを
変更することで現在のインプットメソッドの状態が出力されます。

```bash
$ bin/input-method-observer-client
opened. press ^C to stop...
received: {"enable":true,"keyboard":"Skk","shortState":"あ","longState":"Hiragana"}
received: {"enable":true,"keyboard":"Keyboard - English (US)","shortState":"en","longState":"en"}
received: {"enable":true,"keyboard":"Skk","shortState":"あ","longState":"Hiragana"}
^C
```

### 拡張のインストール

Chrome を起動し、`chrome://extensions` を開きます。`デベロッパーモード` をオンにし、
`パッケージ化されていない拡張機能を読み込む` をクリックして `<リポジトリ>/extension` を指定します。

![IMO Icon](https://appsweets.net/input-method-observer/icon.png "拡張のアイコン")

オブザーバースクリプトの接続に成功すればアイコンがグレー状態から色の付いた芋になります。

## 使い方

任意のページを開き、編集可能な要素をアクティブにすると状態が表示されます。

拡張のアイコンをクリックすると現れるメニューで各種の通知のオン・オフ、および詳細設定ページへの遷移を行うことができます。

## TIPS

### ポートの変更

拡張とオブザーバースクリプト間の接続に用いるポートを変更する場合:

1. `$ systemctl --user stop input-method-observer.service`
2. `$ systemctl --user stop input-method-observer.socket`
3. `~/.config/systemd/user/input-method.socket` を編集し、`ListenStream=` の行を任意に変更
4. `$ systemctl --user daemon-reload`
5. 拡張の設定でポートを新しい値に合わせる

## ライセンス

IMO は [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) ライセンスの下で公開されます。
