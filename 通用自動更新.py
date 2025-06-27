#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
通用 GitHub 儲存庫自動更新腳本
適用於任何 Git 專案，無需特定配置
"""

import os
import sys
import subprocess
import argparse
import time
import locale
from pathlib import Path

def print_colored(text, color='white'):
    """打印彩色文字"""
    colors = {
        'red': '\033[91m',
        'green': '\033[92m',
        'yellow': '\033[93m',
        'blue': '\033[94m',
        'purple': '\033[95m',
        'cyan': '\033[96m',
        'white': '\033[97m',
        'reset': '\033[0m'
    }
    print(f"{colors.get(color, colors['white'])}{text}{colors['reset']}")

def setup_console_encoding():
    """設置控制台編碼為 UTF-8"""
    if os.name == 'nt':  # Windows
        try:
            # 設置控制台代碼頁為 UTF-8
            os.system('chcp 65001 >nul 2>&1')
            # 設置 Python 的標準輸出編碼
            import codecs
            sys.stdout = codecs.getwriter('utf-8')(sys.stdout.detach())
            sys.stderr = codecs.getwriter('utf-8')(sys.stderr.detach())
        except:
            pass
    
    # 設置 locale
    try:
        locale.setlocale(locale.LC_ALL, '')
    except:
        pass

def set_window_title(title):
    """設置終端視窗標題"""
    if os.name == 'nt':  # Windows
        try:
            import ctypes
            ctypes.windll.kernel32.SetConsoleTitleW(title)
        except:
            os.system(f'title {title}')

def run_command(command, description, cwd=None, show_output=False, capture_output=False):
    """執行命令並顯示結果"""
    if not isinstance(command, str):
        cmd_str = ' '.join(command)
    else:
        cmd_str = command
    
    print_colored(f"\n🔄 {description}...", 'cyan')
    try:
        if capture_output:
            # 需要捕獲輸出的情況（如推送衝突檢測）
            result = subprocess.run(
                command,
                cwd=cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding='utf-8',
                errors='ignore',
                shell=True if isinstance(command, str) else False
            )
            
            if result.returncode == 0:
                print_colored(f"✅ {description} 完成", 'green')
                if show_output and result.stdout.strip():
                    print(result.stdout.strip())
                return True, result.stdout
            else:
                print_colored(f"❌ {description} 失敗", 'red')
                # 合併 stdout 和 stderr 以獲取完整的錯誤訊息
                full_output = ""
                if result.stderr.strip():
                    print_colored(result.stderr.strip(), 'red')
                    full_output += result.stderr
                if result.stdout.strip():
                    full_output += "\n" + result.stdout
                return False, full_output.strip()
        else:
            # 即時輸出模式
            result = subprocess.run(
                command,
                cwd=cwd,
                text=True,
                encoding='utf-8',
                errors='ignore',
                shell=True if isinstance(command, str) else False
            )
            
            if result.returncode == 0:
                print_colored(f"✅ {description} 完成", 'green')
                return True, ""
            else:
                print_colored(f"❌ {description} 失敗", 'red')
                return False, ""
    except Exception as e:
        print_colored(f"❌ 執行 {description} 時發生錯誤: {e}", 'red')
        return False, str(e)

def check_git_repository():
    """檢查是否為 Git 儲存庫"""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--git-dir"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            errors='ignore'
        )
        return result.returncode == 0
    except:
        return False

def get_remote_info():
    """獲取遠端儲存庫資訊"""
    try:
        # 獲取遠端 URL
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            errors='ignore'
        )
        remote_url = result.stdout.strip() if result.returncode == 0 else "未知"
        
        # 獲取當前分支
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            errors='ignore'
        )
        current_branch = result.stdout.strip() if result.returncode == 0 else "main"
        
        return remote_url, current_branch
    except:
        return "未知", "main"

def fix_git_safe_directory():
    """修復 Git 安全目錄問題"""
    script_dir = Path.cwd()
    try:
        result = subprocess.run(
            ["git", "config", "--global", "--add", "safe.directory", str(script_dir)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            errors='ignore'
        )
        if result.returncode == 0:
            print_colored("🔧 已修復 Git 安全目錄設定", 'green')
            return True
        else:
            print_colored("⚠️  無法修復 Git 安全目錄設定", 'yellow')
            return False
    except Exception as e:
        print_colored(f"⚠️  修復 Git 安全目錄時發生錯誤: {e}", 'yellow')
        return False

def decode_filename(filename):
    """解碼檔案名稱，處理各種編碼情況"""
    if not filename:
        return filename
    
    original_filename = filename
    
    try:
        # 處理 Git 的引號包圍檔名
        if filename.startswith('"'):
            # 移除引號
            filename = filename.strip('"')
            
            # 檢查是否包含八進制轉義序列
            if '\\' in filename:
                # 終極方法：使用 codecs 解碼八進制序列
                try:
                    # 將八進制序列轉換為原始字節
                    import re
                    import codecs
                    
                    # 替換八進制序列為實際字節
                    def octal_replacer(match):
                        octal_str = match.group(1)
                        byte_val = int(octal_str, 8)
                        return chr(byte_val)
                    
                    # 處理所有八進制序列
                    decoded = re.sub(r'\\([0-7]{3})', octal_replacer, filename)
                    
                    # 嘗試將結果編碼為 bytes 然後解碼為 UTF-8
                    byte_data = decoded.encode('latin1')
                    result = byte_data.decode('utf-8')
                    return result
                    
                except Exception:
                    pass
                
                # 備用方法：直接使用 Python 的字節串解碼
                try:
                    # 將 \351\200\232 格式轉換為 Python bytes 字面量
                    import re
                    
                    # 構建字節序列
                    byte_pattern = r'\\([0-7]{3})'
                    matches = re.findall(byte_pattern, filename)
                    
                    if matches:
                        # 創建字節數組
                        byte_values = [int(match, 8) for match in matches]
                        
                        # 找到非八進制部分
                        non_octal_parts = re.split(byte_pattern, filename)
                        
                        # 重建字符串：非八進制部分 + 解碼的字節
                        result_parts = []
                        byte_index = 0
                        
                        for i, part in enumerate(non_octal_parts):
                            if i % 2 == 0:  # 非八進制部分
                                result_parts.append(part)
                            else:  # 這是八進制值，跳過（已在 byte_values 中處理）
                                pass
                        
                        # 解碼字節序列
                        try:
                            decoded_text = bytes(byte_values).decode('utf-8')
                            # 將解碼的文字插入到正確位置
                            # 簡化：假設所有八進制序列都是連續的
                            first_octal_pos = filename.find('\\')
                            if first_octal_pos >= 0:
                                prefix = filename[:first_octal_pos]
                                # 找到八進制序列後的部分
                                remaining = filename
                                for _ in range(len(byte_values)):
                                    # 移除一個八進制序列 \xxx
                                    remaining = re.sub(r'\\[0-7]{3}', '', remaining, count=1)
                                
                                return prefix + decoded_text + remaining
                        except UnicodeDecodeError:
                            pass
                except Exception:
                    pass
                
                # 最後嘗試：標準解碼方法
                try:
                    # 嘗試 unicode_escape
                    decoded = filename.encode().decode('unicode_escape')
                    return decoded
                except:
                    try:
                        # 嘗試 raw_unicode_escape
                        decoded = filename.encode().decode('raw_unicode_escape')
                        return decoded
                    except:
                        pass
        
        # 如果沒有引號或所有解碼都失敗，返回處理後的字符串
        return filename if filename != original_filename else original_filename
        
    except Exception:
        # 最終回退到原始字符串
        return original_filename


def generate_commit_message(git_status):
    """根據 Git 狀態生成智慧 commit 訊息"""
    if not git_status.strip():
        return "Update content"
    
    lines = git_status.strip().split('\n')
    added_files = []
    modified_files = []
    deleted_files = []
    
    for line in lines:
        if len(line) < 3:
            continue
            
        # Git --porcelain 格式：正確解析狀態和檔名
        if len(line) >= 3 and line[2] == ' ':
            # 標準格式：XY filename
            status = line[:2].strip()
            filename = line[3:]
        else:
            # 可能是簡化格式，需要找到第一個空格
            space_index = line.find(' ')
            if space_index > 0:
                status = line[:space_index].strip()
                filename = line[space_index + 1:]
            else:
                continue
        
        # 解碼檔名
        decoded_filename = decode_filename(filename)
        
        if status in ['A', '??']:
            added_files.append(decoded_filename)
        elif status == 'M':
            modified_files.append(decoded_filename)
        elif status == 'D':
            deleted_files.append(decoded_filename)
    
    # 根據變更類型生成訊息
    total_changes = len(added_files) + len(modified_files) + len(deleted_files)
    
    if total_changes == 1:
        # 單一檔案變更
        if added_files:
            filename = os.path.basename(added_files[0])
            return f"Add {filename}"
        elif modified_files:
            filename = os.path.basename(modified_files[0])
            return f"Update {filename}"
        elif deleted_files:
            filename = os.path.basename(deleted_files[0])
            return f"Delete {filename}"
    
    # 多檔案變更
    if added_files and not modified_files and not deleted_files:
        return "Add files via upload"
    elif modified_files and not added_files and not deleted_files:
        return "Update content"
    elif deleted_files and not added_files and not modified_files:
        return "Delete files"
    else:
        return "Update content"

def display_file_changes(git_status):
    """顯示檔案變更詳情"""
    if not git_status.strip():
        return
        
    print_colored("\n📋 檢測到以下檔案變更:", 'yellow')
    for line in git_status.strip().split('\n'):
        if len(line) < 3:
            continue
            
        # Git --porcelain 格式：正確解析狀態和檔名
        if len(line) >= 3 and line[2] == ' ':
            # 標準格式：XY filename
            status = line[:2]
            filename = line[3:]
        else:
            # 可能是簡化格式，需要找到第一個空格
            space_index = line.find(' ')
            if space_index > 0:
                status = line[:space_index]
                filename = line[space_index + 1:]
            else:
                continue
        
        # 解碼檔名以正確顯示中文
        display_name = decode_filename(filename)
        
        if status.strip() == 'M':
            print_colored(f"   📝 修改: {display_name}", 'yellow')
        elif status.strip() in ['A', '??']:
            print_colored(f"   ➕ 新增: {display_name}", 'green')
        elif status.strip() == 'D':
            print_colored(f"   ❌ 刪除: {display_name}", 'red')
        else:
            print_colored(f"   {status.strip()} {display_name}", 'white')

def setup_git_encoding():
    """設置 Git 編碼配置，避免檔名轉義"""
    try:
        # 設置 Git 不要轉義檔案路徑
        subprocess.run(
            ["git", "config", "core.quotePath", "false"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True
        )
        print_colored("🔧 已設定 Git 編碼配置", 'green')
    except:
        # 如果設定失敗，不影響主要功能
        pass

def handle_push_conflict(target_branch, auto_pull=False):
    """處理推送衝突，嘗試自動拉取並重新推送"""
    print_colored("\n🔍 檢測到推送衝突，遠端有新的提交", 'yellow')
    
    if not auto_pull:
        print_colored("解決方案:", 'cyan')
        print_colored("1. 自動拉取遠端變更並重新推送", 'white')
        print_colored("2. 手動處理（退出腳本）", 'white')
        
        while True:
            choice = input("\n請選擇 (1/2): ").strip()
            if choice == "1":
                break
            elif choice == "2":
                print_colored("請手動執行以下命令解決衝突:", 'yellow')
                print_colored(f"git pull origin {target_branch}", 'cyan')
                print_colored(f"git push origin {target_branch}", 'cyan')
                return False
            else:
                print_colored("請輸入 1 或 2", 'red')
    else:
        print_colored("🤖 自動拉取模式已啟用", 'cyan')
    
    # 嘗試拉取遠端變更
    print_colored(f"\n🔄 正在拉取遠端分支 {target_branch}...", 'cyan')
    success, output = run_command(
        ["git", "pull", "origin", target_branch],
        f"拉取遠端分支 {target_branch}",
        capture_output=True
    )
    
    if not success:
        print_colored("❌ 拉取失敗，可能有合併衝突", 'red')
        print_colored("請手動解決衝突後再次運行腳本", 'yellow')
        if "merge conflict" in output.lower() or "conflict" in output.lower():
            print_colored("檢測到合併衝突，請手動處理:", 'red')
            print_colored("1. 編輯衝突檔案", 'white')
            print_colored("2. git add <已解決的檔案>", 'white')
            print_colored("3. git commit", 'white')
            print_colored(f"4. git push origin {target_branch}", 'white')
        return False
    
    print_colored("✅ 成功拉取遠端變更", 'green')
    
    # 重新嘗試推送
    print_colored(f"\n🔄 重新推送到遠端分支 {target_branch}...", 'cyan')
    success, _ = run_command(
        ["git", "push", "origin", target_branch],
        f"重新推送到遠端分支 {target_branch}",
        capture_output=False
    )
    
    return success

def main():
    """主要執行函數"""
    parser = argparse.ArgumentParser(description="通用 GitHub 儲存庫自動更新工具")
    parser.add_argument("--dry-run", action="store_true", help="預覽模式，不實際執行 commit 和 push")
    parser.add_argument("--message", "-m", help="自定義 commit 訊息")
    parser.add_argument("--branch", "-b", help="指定推送分支（預設為當前分支）")
    parser.add_argument("--no-add", action="store_true", help="不自動添加所有檔案，只處理已暫存的檔案")
    parser.add_argument("--auto-pull", action="store_true", help="推送失敗時自動拉取遠端變更")
    parser.add_argument("--debug", action="store_true", help="顯示調試信息")
    
    args = parser.parse_args()
    
    # 設置控制台編碼
    setup_console_encoding()
    
    # 設置 Git 編碼
    setup_git_encoding()
    
    # 設置視窗標題
    set_window_title("通用 GitHub 自動更新工具")
    
    print_colored("=" * 60, 'blue')
    print_colored("🌟 通用 GitHub 自動更新工具", 'blue')
    print_colored("=" * 60, 'blue')
    
    # 檢查是否為 Git 儲存庫
    if not check_git_repository():
        print_colored("❌ 當前目錄不是 Git 儲存庫", 'red')
        print_colored("請在 Git 專案根目錄中執行此腳本", 'yellow')
        input("\n按 Enter 鍵結束...")
        return
    
    # 獲取儲存庫資訊
    remote_url, current_branch = get_remote_info()
    target_branch = args.branch or current_branch
    
    print_colored(f"📁 工作目錄: {Path.cwd()}", 'yellow')
    print_colored(f"🔗 遠端儲存庫: {remote_url}", 'cyan')
    print_colored(f"🌿 目標分支: {target_branch}", 'cyan')
    
    if args.dry_run:
        print_colored("🔍 預覽模式：將顯示變更但不實際執行提交", 'purple')
    
    # 檢查 Git 狀態
    success, git_status = run_command(
        ["git", "status", "--porcelain"],
        "檢查 Git 狀態",
        capture_output=True
    )
    
    # 如果 Git 狀態檢查失敗，嘗試修復安全目錄問題
    if not success:
        if "dubious ownership" in git_status.lower():
            print_colored("🔍 檢測到 Git 安全目錄問題，正在修復...", 'yellow')
            if fix_git_safe_directory():
                success, git_status = run_command(
                    ["git", "status", "--porcelain"],
                    "重新檢查 Git 狀態",
                    capture_output=True
                )
                if not success:
                    print_colored("❌ 修復後仍然無法檢查 Git 狀態", 'red')
                    input("\n按 Enter 鍵結束...")
                    return
            else:
                print_colored("❌ 無法修復 Git 安全目錄問題", 'red')
                input("\n按 Enter 鍵結束...")
                return
        else:
            print_colored("❌ Git 狀態檢查失敗", 'red')
            input("\n按 Enter 鍵結束...")
            return
    
    if not git_status.strip():
        print_colored("✨ 沒有檔案變更，無需更新", 'green')
        input("\n按 Enter 鍵結束...")
        return
    
    # 顯示變更的檔案
    display_file_changes(git_status)
    
    if args.dry_run:
        # 預覽模式
        commit_message = args.message or generate_commit_message(git_status)
        print_colored(f"\n📝 預覽 Commit 訊息: {commit_message}", 'purple')
        print_colored(f"🌿 預覽目標分支: {target_branch}", 'purple')
        print_colored("\n🔍 預覽模式完成，未執行實際更新", 'purple')
        input("\n按 Enter 鍵結束...")
        return
    
    # 添加檔案到暫存區
    if not args.no_add:
        success, _ = run_command(
            ["git", "add", "."],
            "添加所有變更到暫存區",
            capture_output=False
        )
        
        if not success:
            print_colored("❌ 添加檔案到暫存區失敗", 'red')
            input("\n按 Enter 鍵結束...")
            return
    
    # 生成並顯示 commit 訊息
    commit_message = args.message or generate_commit_message(git_status)
    print_colored(f"\n📝 Commit 訊息: {commit_message}", 'cyan')
    
    # 提交變更
    success, _ = run_command(
        ["git", "commit", "-m", commit_message],
        "提交變更",
        capture_output=False
    )
    
    if not success:
        print_colored("❌ 提交變更失敗", 'red')
        input("\n按 Enter 鍵結束...")
        return
    
    # 推送到遠端儲存庫
    success, push_output = run_command(
        ["git", "push", "origin", target_branch],
        f"推送到遠端分支 {target_branch}",
        capture_output=True
    )
    
    if success:
        print_colored(f"\n🎉 成功更新到 GitHub 分支 {target_branch}!", 'green')
        if "github.com" in remote_url:
            print_colored(f"🔗 儲存庫: {remote_url}", 'cyan')
    else:
        # 調試信息，僅在 debug 模式下顯示
        if args.debug:
            print_colored(f"\n🔍 調試信息 - 推送輸出內容:", 'purple')
            print_colored(f"'{push_output}'", 'purple')
        
        # 檢查是否為推送衝突（擴展關鍵字檢測）
        push_output_lower = push_output.lower()
        conflict_keywords = [
            "fetch first",
            "non-fast-forward", 
            "rejected",
            "updates were rejected",
            "failed to push some refs",
            "tip of your current branch is behind"
        ]
        
        is_push_conflict = any(keyword in push_output_lower for keyword in conflict_keywords)
        
        if is_push_conflict:
            print_colored("🎯 檢測到推送衝突", 'yellow')
            
            # 嘗試處理推送衝突
            conflict_resolved = handle_push_conflict(target_branch, args.auto_pull)
            
            if conflict_resolved:
                print_colored(f"\n🎉 成功解決衝突並更新到 GitHub 分支 {target_branch}!", 'green')
                if "github.com" in remote_url:
                    print_colored(f"🔗 儲存庫: {remote_url}", 'cyan')
            else:
                print_colored(f"\n❌ 無法自動解決推送衝突", 'red')
        else:
            print_colored(f"\n❌ 推送到分支 {target_branch} 失敗", 'red')
            print_colored("請檢查網路連線和 Git 認證設定", 'yellow')
            if push_output.strip():
                print_colored(f"錯誤詳情: {push_output.strip()}", 'red')
    
    print_colored("\n" + "=" * 60, 'blue')
    print_colored("🏁 自動更新流程完成", 'blue')
    print_colored("=" * 60, 'blue')
    
    input("\n按 Enter 鍵結束...")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print_colored("\n\n🛑 用戶中斷操作", 'yellow')
        input("按 Enter 鍵結束...")
    except Exception as e:
        print_colored(f"\n❌ 發生未預期的錯誤: {e}", 'red')
        input("按 Enter 鍵結束...")