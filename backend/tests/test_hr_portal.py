"""
HR Portal Backend API Tests
Tests: Admin login, employee creation, password reset, employee login, leave requests, attendance
"""
import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://attendance-hub-1369.preview.emergentagent.com')

# Test data
ADMIN_EMAIL = "admin@hrportal.com"
ADMIN_PASSWORD = "Admin@123"
TEST_EMPLOYEE_EMAIL = f"test_employee_{datetime.now().strftime('%H%M%S')}@company.com"
TEST_EMPLOYEE_PASSWORD = "TestPass@123"
TEST_EMPLOYEE_NAME = "Test Employee"
RESET_PASSWORD = "NewPass@456"


class TestAdminAuth:
    """Test admin authentication"""
    
    def test_admin_login_success(self):
        """Test admin can login with correct credentials"""
        session = requests.Session()
        response = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
        )
        print(f"Admin login response: {response.status_code}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["email"] == ADMIN_EMAIL
        assert data["role"] == "admin"
        assert "id" in data
        print(f"Admin login successful: {data['name']} ({data['role']})")
    
    def test_admin_login_wrong_password(self):
        """Test admin login fails with wrong password"""
        session = requests.Session()
        response = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": "WrongPassword"}
        )
        print(f"Wrong password response: {response.status_code}")
        assert response.status_code == 401
    
    def test_admin_login_wrong_email(self):
        """Test admin login fails with wrong email"""
        session = requests.Session()
        response = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "wrong@email.com", "password": ADMIN_PASSWORD}
        )
        print(f"Wrong email response: {response.status_code}")
        assert response.status_code == 401


class TestEmployeeManagement:
    """Test employee CRUD operations by admin"""
    
    @pytest.fixture
    def admin_session(self):
        """Get authenticated admin session"""
        session = requests.Session()
        response = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
        )
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        return session
    
    def test_admin_create_employee(self, admin_session):
        """Test admin can create a new employee"""
        employee_data = {
            "email": TEST_EMPLOYEE_EMAIL,
            "password": TEST_EMPLOYEE_PASSWORD,
            "name": TEST_EMPLOYEE_NAME,
            "department": "Engineering",
            "position": "Developer"
        }
        
        response = admin_session.post(
            f"{BASE_URL}/api/admin/employees",
            json=employee_data
        )
        print(f"Create employee response: {response.status_code}")
        print(f"Response body: {response.text}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["email"] == TEST_EMPLOYEE_EMAIL.lower()
        assert data["name"] == TEST_EMPLOYEE_NAME
        assert data["role"] == "employee"
        assert data["department"] == "Engineering"
        assert "id" in data
        
        # Store employee ID for later tests
        pytest.employee_id = data["id"]
        print(f"Employee created with ID: {pytest.employee_id}")
    
    def test_admin_get_employees(self, admin_session):
        """Test admin can get list of employees"""
        response = admin_session.get(f"{BASE_URL}/api/admin/employees")
        print(f"Get employees response: {response.status_code}")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 1  # At least admin exists
        print(f"Found {len(data)} employees")
    
    def test_new_employee_can_login(self):
        """Test newly created employee can login with their credentials"""
        session = requests.Session()
        response = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMPLOYEE_EMAIL, "password": TEST_EMPLOYEE_PASSWORD}
        )
        print(f"Employee login response: {response.status_code}")
        
        assert response.status_code == 200, f"Employee login failed: {response.text}"
        
        data = response.json()
        assert data["email"] == TEST_EMPLOYEE_EMAIL.lower()
        assert data["role"] == "employee"
        print(f"Employee login successful: {data['name']}")


class TestPasswordReset:
    """Test admin password reset functionality"""
    
    @pytest.fixture
    def admin_session(self):
        """Get authenticated admin session"""
        session = requests.Session()
        response = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
        )
        assert response.status_code == 200
        return session
    
    def test_admin_reset_employee_password(self, admin_session):
        """Test admin can reset employee password"""
        # First get the employee ID
        response = admin_session.get(f"{BASE_URL}/api/admin/employees")
        assert response.status_code == 200
        
        employees = response.json()
        test_employee = next((e for e in employees if e["email"] == TEST_EMPLOYEE_EMAIL.lower()), None)
        
        if not test_employee:
            pytest.skip("Test employee not found - run test_admin_create_employee first")
        
        employee_id = test_employee["id"]
        
        # Reset password
        response = admin_session.post(
            f"{BASE_URL}/api/admin/employees/{employee_id}/reset-password",
            json={"new_password": RESET_PASSWORD}
        )
        print(f"Reset password response: {response.status_code}")
        
        assert response.status_code == 200, f"Password reset failed: {response.text}"
        data = response.json()
        assert "message" in data
        print(f"Password reset successful: {data['message']}")
    
    def test_employee_login_with_new_password(self):
        """Test employee can login with reset password"""
        session = requests.Session()
        response = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMPLOYEE_EMAIL, "password": RESET_PASSWORD}
        )
        print(f"Login with new password response: {response.status_code}")
        
        assert response.status_code == 200, f"Login with new password failed: {response.text}"
        
        data = response.json()
        assert data["email"] == TEST_EMPLOYEE_EMAIL.lower()
        print(f"Employee login with new password successful")
    
    def test_employee_old_password_fails(self):
        """Test employee cannot login with old password after reset"""
        session = requests.Session()
        response = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMPLOYEE_EMAIL, "password": TEST_EMPLOYEE_PASSWORD}
        )
        print(f"Login with old password response: {response.status_code}")
        
        # Should fail with 401
        assert response.status_code == 401, "Old password should not work after reset"
        print("Old password correctly rejected")


class TestForgotPasswordInfo:
    """Test forgot password info endpoint"""
    
    def test_password_reset_info_endpoint(self):
        """Test password reset info returns contact HR message"""
        session = requests.Session()
        response = session.get(f"{BASE_URL}/api/auth/password-reset-info")
        print(f"Password reset info response: {response.status_code}")
        
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "contact" in data["message"].lower() or "hr" in data["message"].lower()
        print(f"Password reset info: {data['message']}")


class TestAdminDashboardTabs:
    """Test admin dashboard API endpoints for all tabs"""
    
    @pytest.fixture
    def admin_session(self):
        """Get authenticated admin session"""
        session = requests.Session()
        response = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
        )
        assert response.status_code == 200
        return session
    
    def test_analytics_endpoint(self, admin_session):
        """Test Overview tab - analytics endpoint"""
        response = admin_session.get(f"{BASE_URL}/api/admin/analytics")
        print(f"Analytics response: {response.status_code}")
        
        assert response.status_code == 200
        data = response.json()
        assert "total_employees" in data
        assert "present_today" in data
        assert "pending_leaves" in data
        print(f"Analytics: {data['total_employees']} employees, {data['present_today']} present")
    
    def test_employees_endpoint(self, admin_session):
        """Test Employees tab endpoint"""
        response = admin_session.get(f"{BASE_URL}/api/admin/employees")
        print(f"Employees response: {response.status_code}")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} employees")
    
    def test_payslips_endpoint(self, admin_session):
        """Test Payslips tab endpoint"""
        response = admin_session.get(f"{BASE_URL}/api/admin/payslips")
        print(f"Payslips response: {response.status_code}")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} payslips")
    
    def test_leave_requests_endpoint(self, admin_session):
        """Test Leave Requests tab endpoint"""
        response = admin_session.get(f"{BASE_URL}/api/admin/leave-requests")
        print(f"Leave requests response: {response.status_code}")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} leave requests")
    
    def test_attendance_endpoint(self, admin_session):
        """Test Attendance tab endpoint"""
        response = admin_session.get(f"{BASE_URL}/api/admin/attendance")
        print(f"Attendance response: {response.status_code}")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} attendance records")
    
    def test_permissions_endpoint(self, admin_session):
        """Test Permissions tab endpoint"""
        response = admin_session.get(f"{BASE_URL}/api/admin/permissions")
        print(f"Permissions response: {response.status_code}")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Found {len(data)} permission requests")


class TestEmployeeDashboard:
    """Test employee dashboard features"""
    
    @pytest.fixture
    def employee_session(self):
        """Get authenticated employee session"""
        session = requests.Session()
        response = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMPLOYEE_EMAIL, "password": RESET_PASSWORD}
        )
        if response.status_code != 200:
            pytest.skip("Employee not available for testing")
        return session
    
    def test_attendance_status(self, employee_session):
        """Test attendance status endpoint"""
        response = employee_session.get(f"{BASE_URL}/api/attendance/status")
        print(f"Attendance status response: {response.status_code}")
        
        assert response.status_code == 200
        data = response.json()
        assert "clocked_in" in data
        assert "on_break" in data
        print(f"Attendance status: clocked_in={data['clocked_in']}, on_break={data['on_break']}")
    
    def test_leave_balance(self, employee_session):
        """Test leave balance endpoint"""
        response = employee_session.get(f"{BASE_URL}/api/leave/balance")
        print(f"Leave balance response: {response.status_code}")
        
        assert response.status_code == 200
        data = response.json()
        assert "casual" in data
        assert "sick" in data
        assert "earned" in data
        print(f"Leave balance: casual={data['casual']}, sick={data['sick']}, earned={data['earned']}")
    
    def test_clock_in_out_flow(self, employee_session):
        """Test clock in/out flow"""
        # Check current status
        status_response = employee_session.get(f"{BASE_URL}/api/attendance/status")
        status = status_response.json()
        
        if status["clocked_in"]:
            # Clock out first
            response = employee_session.post(f"{BASE_URL}/api/attendance/clock-out")
            print(f"Clock out response: {response.status_code}")
        
        # Clock in
        response = employee_session.post(f"{BASE_URL}/api/attendance/clock-in")
        print(f"Clock in response: {response.status_code}")
        
        assert response.status_code == 200, f"Clock in failed: {response.text}"
        data = response.json()
        assert "clock_in" in data
        print(f"Clocked in at: {data['clock_in']}")
        
        # Verify status
        status_response = employee_session.get(f"{BASE_URL}/api/attendance/status")
        status = status_response.json()
        assert status["clocked_in"] == True
        
        # Clock out
        response = employee_session.post(f"{BASE_URL}/api/attendance/clock-out")
        print(f"Clock out response: {response.status_code}")
        
        assert response.status_code == 200, f"Clock out failed: {response.text}"
        print("Clock in/out flow successful")
    
    def test_leave_request_submission(self, employee_session):
        """Test leave request submission"""
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        day_after = (datetime.now() + timedelta(days=2)).strftime("%Y-%m-%d")
        
        leave_data = {
            "leave_type": "casual",
            "start_date": tomorrow,
            "end_date": day_after,
            "reason": "Test leave request"
        }
        
        response = employee_session.post(
            f"{BASE_URL}/api/leave/request",
            json=leave_data
        )
        print(f"Leave request response: {response.status_code}")
        
        assert response.status_code == 200, f"Leave request failed: {response.text}"
        data = response.json()
        assert data["status"] == "pending"
        assert data["leave_type"] == "casual"
        print(f"Leave request created with ID: {data['id']}")
        
        # Store for cleanup
        pytest.leave_request_id = data["id"]
    
    def test_my_shift_endpoint(self, employee_session):
        """Test my shift endpoint"""
        response = employee_session.get(f"{BASE_URL}/api/attendance/my-shift")
        print(f"My shift response: {response.status_code}")
        
        assert response.status_code == 200
        data = response.json()
        assert "shift" in data
        assert "name" in data
        print(f"Shift: {data['name']} ({data.get('start_time', 'N/A')} - {data.get('end_time', 'N/A')})")


class TestCleanup:
    """Cleanup test data"""
    
    @pytest.fixture
    def admin_session(self):
        """Get authenticated admin session"""
        session = requests.Session()
        response = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
        )
        assert response.status_code == 200
        return session
    
    def test_cleanup_test_employee(self, admin_session):
        """Delete test employee"""
        # Get employee ID
        response = admin_session.get(f"{BASE_URL}/api/admin/employees")
        employees = response.json()
        test_employee = next((e for e in employees if e["email"] == TEST_EMPLOYEE_EMAIL.lower()), None)
        
        if test_employee:
            response = admin_session.delete(f"{BASE_URL}/api/admin/employees/{test_employee['id']}")
            print(f"Delete employee response: {response.status_code}")
            assert response.status_code == 200
            print(f"Test employee deleted")
        else:
            print("Test employee not found for cleanup")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
