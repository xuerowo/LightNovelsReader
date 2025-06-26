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

def set_window_title(title):
    """設置終端視窗標題"""
    if os.name == 'nt':  # Windows
        try:
            import ctypes
            ctypes.windll.kernel32.SetConsoleTitleW(title)
        except:
            os.system(f'title {title}')

def run_command(command, description, cwd=None, show_output=False):
    """執行命令並顯示結果"""
    if not isinstance(command, str):
        cmd_str = ' '.join(command)
    else:
        cmd_str = command
    
    print_colored(f"\n🔄 {description}...", 'cyan')
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            capture_output=True,
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
            if result.stderr.strip():
                print_colored(result.stderr.strip(), 'red')
            return False, result.stderr
    except Exception as e:
        print_colored(f"❌ 執行 {description} 時發生錯誤: {e}", 'red')
        return False, str(e)

def check_git_repository():
    """檢查是否為 Git 儲存庫"""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--git-dir"],
            capture_output=True,
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
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='ignore'
        )
        remote_url = result.stdout.strip() if result.returncode == 0 else "未知"
        
        # 獲取當前分支
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            capture_output=True,
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
            capture_output=True,
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
            
        status = line[:2].strip()
        filename = line[3:]
        
        # 清理檔名中的編碼問題
        try:
            if filename.startswith('"') and filename.endswith('"'):
                filename = filename[1:-1]
                filename = filename.encode().decode('unicode_escape')
        except:
            pass
        
        if status in ['A', '??']:
            added_files.append(filename)
        elif status == 'M':
            modified_files.append(filename)
        elif status == 'D':
            deleted_files.append(filename)
    
    # 根據變更類型生成訊息
    total_changes = len(added_files) + len(modified_files) + len(deleted_files)
    
    if total_changes == 1:
        # 單一檔案變更
        if added_files:
            return "Add files via upload"
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
            
        status = line[:2]
        filename = line[3:]
        
        # 清理檔名顯示
        try:
            if filename.startswith('"') and filename.endswith('"'):
                display_name = filename[1:-1].encode().decode('unicode_escape')
            else:
                display_name = filename
        except:
            display_name = filename
        
        if status.strip() == 'M':
            print_colored(f"   📝 修改: {display_name}", 'yellow')
        elif status.strip() in ['A', '??']:
            print_colored(f"   ➕ 新增: {display_name}", 'green')
        elif status.strip() == 'D':
            print_colored(f"   ❌ 刪除: {display_name}", 'red')
        else:
            print_colored(f"   {status.strip()} {display_name}", 'white')

def main():
    """主要執行函數"""
    parser = argparse.ArgumentParser(description="通用 GitHub 儲存庫自動更新工具")
    parser.add_argument("--dry-run", action="store_true", help="預覽模式，不實際執行 commit 和 push")
    parser.add_argument("--message", "-m", help="自定義 commit 訊息")
    parser.add_argument("--branch", "-b", help="指定推送分支（預設為當前分支）")
    parser.add_argument("--no-add", action="store_true", help="不自動添加所有檔案，只處理已暫存的檔案")
    
    args = parser.parse_args()
    
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
        "檢查 Git 狀態"
    )
    
    # 如果 Git 狀態檢查失敗，嘗試修復安全目錄問題
    if not success:
        if "dubious ownership" in git_status.lower():
            print_colored("🔍 檢測到 Git 安全目錄問題，正在修復...", 'yellow')
            if fix_git_safe_directory():
                success, git_status = run_command(
                    ["git", "status", "--porcelain"],
                    "重新檢查 Git 狀態"
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
            "添加所有變更到暫存區"
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
        "提交變更"
    )
    
    if not success:
        print_colored("❌ 提交變更失敗", 'red')
        input("\n按 Enter 鍵結束...")
        return
    
    # 推送到遠端儲存庫
    success, _ = run_command(
        ["git", "push", "origin", target_branch],
        f"推送到遠端分支 {target_branch}"
    )
    
    if success:
        print_colored(f"\n🎉 成功更新到 GitHub 分支 {target_branch}!", 'green')
        if "github.com" in remote_url:
            print_colored(f"🔗 儲存庫: {remote_url}", 'cyan')
    else:
        print_colored(f"\n❌ 推送到分支 {target_branch} 失敗", 'red')
        print_colored("請檢查網路連線和 Git 認證設定", 'yellow')
    
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