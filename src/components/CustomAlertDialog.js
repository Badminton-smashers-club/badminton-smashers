const CustomAlertDialog = ({ message, onConfirm, onCancel, confirmText = 'Confirm', cancelText = 'Cancel' }) => {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-sm w-full space-y-6 text-center">
          <h3 className="text-2xl font-bold text-blue-700">Confirmation</h3>
          <p className="text-lg text-gray-700">{message}</p>
          <div className="flex justify-center space-x-4 mt-6">
            <button
              onClick={onCancel}
              className="bg-gray-300 text-gray-800 py-2 px-4 rounded-lg shadow-md hover:bg-gray-400 transition duration-200 ease-in-out"
            >
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              className="bg-blue-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-blue-700 transition duration-200 ease-in-out"
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    );
  };